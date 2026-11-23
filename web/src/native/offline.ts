import { Capacitor } from "@capacitor/core";
import { Directory, Encoding, Filesystem } from "@capacitor/filesystem";
import { cacheDaysOptions, type CacheDays, type DownloadItem, type OfflineTrack } from "../lib/apiTypes";
import type { Track } from "../lib/types";
import { forgetUrl, resolveAudio } from "./streams";

const CACHE = "audio-cache";
const DOWNLOADS = "downloads";
const DAYS_KEY = "earful:cache-days";
const data = { directory: Directory.Data } as const;
const text = { ...data, encoding: Encoding.UTF8 } as const;
const ios = Capacitor.getPlatform() === "ios";
const iosUserAgent = "com.google.ios.youtube/20.10.4 (iPhone16,2; U; CPU iOS 18_1_0 like Mac OS X;)";

interface FileEntry {
  track: Track;
  bytes: number;
  mime: string;
}
type CacheEntry = FileEntry & { cachedAt: number; lastPlayedAt: number };
type DownloadEntry = FileEntry & { downloadedAt: number };
type CacheJob = { track: Track; lastPlayedAt: number; generation: number; done: Promise<void> };

const cacheJobs = new Map<string, CacheJob>();
const downloadJobs = new Map<string, DownloadItem>();
let activeDownload: Promise<void> | undefined;
let generation = 0;
let chain = Promise.resolve();
let indexes: { cache: Record<string, CacheEntry>; downloads: Record<string, DownloadEntry> } | undefined;

const indexPath = (dir: string) => `${dir}/index.json`;
const filePath = (dir: string, id: string, mime: string) => `${dir}/${id}.${mime.startsWith("audio/webm") ? "webm" : "m4a"}`;
const missing = (error: { code?: string; message: string }) => {
  if (error.code === "OS-PLUG-FILE-0008" || /not found|does not exist|no such file/i.test(error.message)) return null;
  throw error;
};
const stat = (path: string) => Filesystem.stat({ ...data, path }).catch(missing);
const deleteFile = async (path: string) => {
  if (await stat(path)) await Filesystem.deleteFile({ ...data, path });
};
const rename = (from: string, to: string) => Filesystem.rename({ ...data, from, to });

async function ensureDirectory(dir: string) {
  if (await stat(dir)) return;
  try {
    await Filesystem.mkdir({ ...data, path: dir, recursive: true });
  } catch (error) {
    if (!await stat(dir)) throw error;
  }
}

async function readIndex<T>(dir: string): Promise<Record<string, T>> {
  const path = indexPath(dir);
  for (const candidate of [path, path + ".tmp"]) {
    if (!await stat(candidate)) continue;
    const result = await Filesystem.readFile({ ...text, path: candidate });
    return JSON.parse(typeof result.data === "string" ? result.data : await result.data.text());
  }
  return {};
}

async function writeIndex(dir: string, entries: unknown) {
  const path = indexPath(dir);
  const temporary = path + ".tmp";
  await Filesystem.writeFile({ ...text, path: temporary, data: JSON.stringify(entries), recursive: true });
  await deleteFile(path);
  await rename(temporary, path);
}

// Keep file moves, index updates and eviction ordered without holding the lock during a network transfer.
function withIndexes<T>(work: (state: NonNullable<typeof indexes>) => Promise<T>): Promise<T> {
  const result = chain.then(async () => {
    indexes ??= { cache: await readIndex<CacheEntry>(CACHE), downloads: await readIndex<DownloadEntry>(DOWNLOADS) };
    return work(indexes);
  });
  chain = result.then(() => {}, () => {});
  return result;
}

function days() {
  const raw = localStorage.getItem(DAYS_KEY);
  return cacheDaysOptions.find((value) => String(value) === raw) ?? 7;
}

async function existing<T extends FileEntry>(dir: string, entries: Record<string, T>, id: string) {
  const entry = entries[id];
  if (!entry) return;
  const path = filePath(dir, id, entry.mime);
  const file = await stat(path);
  if (!file) {
    delete entries[id];
    await writeIndex(dir, entries);
    return;
  }
  return { entry, path, uri: file.uri };
}

async function listEntries<T extends FileEntry>(dir: string, entries: Record<string, T>) {
  const indexed = Object.entries(entries);
  if (!indexed.length) return [];
  const listing = await Filesystem.readdir({ ...data, path: dir }).catch(missing);
  const paths = new Set(listing?.files.map(({ name }) => `${dir}/${name}`));
  const found: T[] = [];
  for (const [id, entry] of indexed) {
    if (paths.has(filePath(dir, id, entry.mime))) found.push(entry);
    else delete entries[id];
  }
  if (found.length !== indexed.length) await writeIndex(dir, entries);
  return found;
}

async function fetchFile(id: string, path: string, onProgress?: (value: number) => void) {
  // The Android implementation of downloadFile expects the parent directory to exist.
  await ensureDirectory(path.slice(0, path.lastIndexOf("/")));
  const download = async () => {
    const audio = await resolveAudio(id);
    const expected = Number(new URL(audio.url).searchParams.get("clen"));
    const listener = onProgress && await Filesystem.addListener("progress", ({ url, bytes, contentLength }) => {
      if (url === audio.url && (expected || contentLength) > 0) {
        onProgress(Math.min(0.99, bytes / (expected || contentLength)));
      }
    });
    try {
      await Filesystem.downloadFile({
        ...data, path, url: audio.url, recursive: true, progress: !!onProgress,
        headers: ios ? { "User-Agent": iosUserAgent } : {},
        connectTimeout: 15_000, readTimeout: 30_000,
      });
      const bytes = (await stat(path))?.size ?? 0;
      if (!bytes || (expected && bytes !== expected)) throw new Error("Incomplete audio transfer");
      return { mime: audio.mime, bytes };
    } catch (error) {
      forgetUrl(audio.url);
      throw error;
    } finally {
      await listener?.remove();
    }
  };
  // The Filesystem plugin can omit the HTTP status on an expired URL.
  return download().catch(() => download());
}

export const localAudio = (id: string) => withIndexes(async ({ cache, downloads }) => {
  return await existing(DOWNLOADS, downloads, id) ?? await existing(CACHE, cache, id);
});

export function cacheTrack(track: Track, played: boolean): Promise<void> {
  return withIndexes<{ done: Promise<void> } | undefined>(async ({ cache, downloads }) => {
    const id = track.id;
    const lastPlayedAt = played ? Date.now() : 0;
    const hit = await existing(CACHE, cache, id);
    if (hit) {
      if (played) {
        Object.assign(hit.entry, { track, lastPlayedAt });
        await writeIndex(CACHE, cache);
      }
      return;
    }
    if (await existing(DOWNLOADS, downloads, id)) return;
    const pending = cacheJobs.get(id);
    if (pending) {
      if (played && pending.generation === generation) Object.assign(pending, { track, lastPlayedAt });
      return pending.generation === generation
        ? pending
        : { done: pending.done.catch(() => {}).then(() => cacheTrack(track, played)) };
    }
    const download = downloadJobs.get(id);
    if (download?.status === "queued" || download?.status === "downloading") return;
    const part = `${CACHE}/${id}.part`;
    const job: CacheJob = { track, lastPlayedAt, generation, done: Promise.resolve() };
    job.done = fetchFile(id, part).then((file) => withIndexes(async ({ cache }) => {
      if (job.generation !== generation) return;
      const path = filePath(CACHE, id, file.mime);
      await rename(part, path);
      cache[id] = { ...file, track: job.track, lastPlayedAt: job.lastPlayedAt, cachedAt: Date.now() };
      try {
        await writeIndex(CACHE, cache);
      } catch (error) {
        delete cache[id];
        await deleteFile(path);
        throw error;
      }
    })).finally(async () => {
      try {
        await deleteFile(part);
      } finally {
        cacheJobs.delete(id);
      }
    });
    cacheJobs.set(id, job);
    return job;
  }).then((job) => job?.done);
}

export const cacheStats = () => withIndexes(async ({ cache }) => {
  const entries = await listEntries(CACHE, cache);
  return { days: days(), count: entries.length, bytes: entries.reduce((total, entry) => total + entry.bytes, 0) };
});

function prune() {
  return withIndexes(async ({ cache }) => {
    const retention = days();
    if (!retention) return;
    const cutoff = Date.now() - retention * 86400_000;
    let changed = false;
    for (const [id, entry] of Object.entries(cache)) {
      if ((entry.lastPlayedAt || entry.cachedAt) >= cutoff) continue;
      await deleteFile(filePath(CACHE, id, entry.mime));
      delete cache[id];
      changed = true;
    }
    if (changed) await writeIndex(CACHE, cache);
  });
}

export async function setCacheDays(value: CacheDays) {
  localStorage.setItem(DAYS_KEY, String(value));
  await prune();
  return cacheStats();
}

export async function clearCache() {
  await withIndexes(async (state) => {
    generation++;
    if (await stat(CACHE)) {
      const { files } = await Filesystem.readdir({ ...data, path: CACHE });
      for (const { name } of files) {
        if (/^[\w-]{11}\.(m4a|webm)$/.test(name) || /^[\w-]{11}\.part$/.test(name) && !cacheJobs.has(name.slice(0, 11))) {
          await deleteFile(`${CACHE}/${name}`);
        }
      }
    }
    state.cache = {};
    await writeIndex(CACHE, state.cache);
  });
  return cacheStats();
}

export const offline = () => withIndexes(async ({ cache, downloads }) => {
  const tracks: OfflineTrack[] = [];
  const ids = new Set<string>();
  for (const entry of (await listEntries(DOWNLOADS, downloads)).sort((a, b) => b.downloadedAt - a.downloadedAt)) {
    ids.add(entry.track.id);
    tracks.push({ ...entry.track, offline: "downloaded" });
  }
  for (const entry of (await listEntries(CACHE, cache)).sort((a, b) => b.cachedAt - a.cachedAt)) {
    if (ids.has(entry.track.id)) continue;
    tracks.push({ ...entry.track, offline: "cached" });
  }
  return { tracks };
});

async function downloadFile(item: DownloadItem) {
  const { track } = item;
  const id = track.id;
  const part = `${DOWNLOADS}/${id}.part`;
  await cacheJobs.get(id)?.done.catch(() => {});
  try {
    const copied = await withIndexes(async ({ cache }) => {
      const hit = await existing(CACHE, cache, id);
      if (!hit) return;
      await ensureDirectory(DOWNLOADS);
      await deleteFile(part);
      await Filesystem.copy({ ...data, from: hit.path, to: part });
      return hit.entry;
    });
    const { mime, bytes } = copied ?? await fetchFile(id, part, (progress) => { item.progress = progress; });
    await withIndexes(async ({ downloads }) => {
      if (downloadJobs.get(id) !== item) return;
      const file = filePath(DOWNLOADS, id, mime);
      await rename(part, file);
      downloads[id] = { track, mime, bytes, downloadedAt: Date.now() };
      try {
        await writeIndex(DOWNLOADS, downloads);
      } catch (error) {
        delete downloads[id];
        await deleteFile(file);
        throw error;
      }
      downloadJobs.delete(id);
    });
  } finally {
    await deleteFile(part);
  }
}

function pump() {
  if (activeDownload) return;
  const item = [...downloadJobs.values()].find((job) => job.status === "queued");
  if (!item) return;
  item.status = "downloading";
  activeDownload = downloadFile(item).catch(() => {
    Object.assign(item, { status: "error", progress: 0, error: "downloadFailed" });
  }).finally(() => {
    activeDownload = undefined;
    pump();
  });
}

export const enqueueDownloads = (tracks: Track[]) => withIndexes(async ({ downloads }) => {
  let queued = 0;
  for (const track of tracks) {
    const job = downloadJobs.get(track.id);
    if (job?.status === "queued" || job?.status === "downloading" || await existing(DOWNLOADS, downloads, track.id)) continue;
    downloadJobs.set(track.id, { track, status: "queued", progress: 0 });
    queued++;
  }
  pump();
  return { queued, skipped: tracks.length - queued };
});

export const downloadStatus = () => withIndexes(async ({ downloads }) => {
  const items = [...downloadJobs.values()].map((item) => ({ ...item }));
  for (const entry of (await listEntries(DOWNLOADS, downloads)).sort((a, b) => b.downloadedAt - a.downloadedAt)) {
    items.push({ track: entry.track, status: "done", progress: 1 });
  }
  let dir = DOWNLOADS;
  try {
    dir = decodeURI((await Filesystem.getUri({ ...data, path: DOWNLOADS })).uri);
  } catch {
    // The folder is created with the first download.
  }
  return { dir, items };
});

export const removeDownload = (id: string) => withIndexes(async ({ downloads }) => {
  downloadJobs.delete(id);
  const hit = await existing(DOWNLOADS, downloads, id);
  if (!hit) return;
  await deleteFile(hit.path);
  delete downloads[id];
  await writeIndex(DOWNLOADS, downloads);
});

if (Capacitor.isNativePlatform()) {
  const pruneIfDue = () => {
    if (Date.now() - lastPrune < 3600_000 || document.hidden) return;
    lastPrune = Date.now();
    void prune().catch(() => {});
  };
  let lastPrune = 0;
  pruneIfDue();
  setInterval(pruneIfDue, 3600_000);
  document.addEventListener("visibilitychange", pruneIfDue);
}
