import { createWriteStream, existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync } from "node:fs";
import path from "node:path";
import { once } from "node:events";
import { Readable } from "node:stream";
import { config } from "./config.js";
import { msg } from "./i18n.js";
import { getSettings, readJson, writeJson } from "./settings.js";
import { HttpError, type Track } from "./types.js";
import { invalidate, resolveStreams } from "./ytdlp.js";

export function audioExtension(mime: string) {
  return mime.startsWith("audio/webm") ? "webm" : "m4a";
}

/**
 * googlevideo throttles one long request for a whole file to about playback speed (a 5 MB song took minutes);
 * pieces asked for with its `range` URL parameter come at full speed. yt-dlp downloads the same way.
 */
const CHUNK_BYTES = 10 * 1024 * 1024;

export async function fetchAudio(id: string, file: string, signal?: AbortSignal, progress?: (value: number) => void) {
  const transfer = new AbortController();
  signal = signal ? AbortSignal.any([signal, transfer.signal]) : transfer.signal;
  let idle: ReturnType<typeof setTimeout> | undefined;
  const resetTimeout = () => {
    clearTimeout(idle);
    idle = setTimeout(() => transfer.abort(), 30_000).unref();
  };
  const request = async (start: number) => {
    const resolved = await resolveStreams(id);
    const url = new URL(resolved.audio.url);
    url.searchParams.set("range", `${start}-${start + CHUNK_BYTES - 1}`);
    const headers = new Headers(resolved.audio.headers);
    headers.delete("range");
    resetTimeout();
    const response = await fetch(url, { headers, signal });
    return { resolved, response };
  };

  const out = createWriteStream(file);
  try {
    let resolved: Awaited<ReturnType<typeof resolveStreams>> | undefined;
    let total = 0;
    let received = 0;
    for (;;) {
      let next = await request(received);
      if (next.response.status === 403 || next.response.status === 410) {
        // Expired URL: resolve again once per piece. A different format would not continue the same file.
        await next.response.body?.cancel();
        invalidate(id);
        next = await request(received);
        if (resolved && next.resolved.audio.formatId !== resolved.audio.formatId) {
          await next.response.body?.cancel();
          throw new HttpError(502, msg("incompleteAudio"));
        }
      }
      const { response } = next;
      if (!response.ok || !response.body) {
        await response.body?.cancel();
        throw new HttpError(502, msg("streamRefused", { status: response.status }));
      }
      resolved = next.resolved;
      total ||= Number(new URL(resolved.audio.url).searchParams.get("clen")) || 0;

      let piece = 0;
      for await (const chunk of Readable.fromWeb(response.body as any) as AsyncIterable<Buffer>) {
        resetTimeout();
        piece += chunk.length;
        received += chunk.length;
        if (total) progress?.(Math.min(0.99, received / total));
        if (!out.write(chunk)) await once(out, "drain", { signal });
      }
      // Done when the known size is reached, or (size unknown) when a piece comes back short.
      if (!piece || (total ? received >= total : piece < CHUNK_BYTES)) break;
    }
    await new Promise<void>((resolve, reject) => out.end((error?: Error | null) => (error ? reject(error) : resolve())));
    if (!received || (total && received !== total)) throw new HttpError(502, msg("incompleteAudio"));
    return resolved!;
  } finally {
    clearTimeout(idle);
    if (!out.closed) out.destroy();
  }
}

interface Entry {
  track: Track;
  bytes: number;
  mime: string;
  cachedAt: number;
  lastPlayedAt: number;
}

interface CacheJob {
  done: Promise<void>;
  controller: AbortController;
  track?: Track;
  lastPlayedAt: number;
}

const dir = path.join(config.cacheDir, "audio");
const file = path.join(dir, "index.json");
let index: Record<string, Entry> | undefined;
const entries = () => index ??= readJson<Record<string, Entry>>(file, {});
const jobs = new Map<string, CacheJob>();
let timer: ReturnType<typeof setTimeout> | undefined;

export function flushAudioCache() {
  if (!timer) return;
  clearTimeout(timer);
  timer = undefined;
  writeJson(file, entries());
}

function changed() {
  timer ??= setTimeout(() => {
    try {
      flushAudioCache();
    } catch (error) {
      console.warn("Could not write audio cache index", error);
    }
  }, 500).unref();
}

const entryPath = (id: string, mime: string) => path.join(dir, `${id}.${audioExtension(mime)}`);

export function cachedAudio(id: string, played = false) {
  const entry = entries()[id];
  if (!entry) return;
  const file = entryPath(id, entry.mime);
  if (!existsSync(file)) {
    delete entries()[id];
    changed();
    return;
  }
  if (played) {
    entry.lastPlayedAt = Date.now();
    changed();
  }
  return { ...entry, file };
}

export const pendingCache = (id: string) => jobs.get(id)?.done;

export function cacheAudio(id: string, played: boolean, track?: Track): Promise<void> {
  const hit = cachedAudio(id, played);
  if (hit) {
    if (track && (played || !hit.lastPlayedAt)) {
      entries()[id].track = track;
      changed();
    }
    return Promise.resolve();
  }

  const pending = jobs.get(id);
  if (pending) {
    if (track && (played || !pending.track)) pending.track = track;
    if (played) pending.lastPlayedAt = Date.now();
    return pending.done;
  }

  const controller = new AbortController();
  const part = path.join(dir, id + ".part");
  const job: CacheJob = { controller, track, lastPlayedAt: played ? Date.now() : 0, done: Promise.resolve() };
  job.done = Promise.resolve().then(async () => {
    mkdirSync(dir, { recursive: true });
    const resolved = await fetchAudio(id, part, controller.signal);
    controller.signal.throwIfAborted();
    const mime = resolved.audio.mime;
    const bytes = statSync(part).size;
    renameSync(part, entryPath(id, mime));
    entries()[id] = {
      track: job.track ?? { id, title: resolved.title || id, artist: "", duration: resolved.duration, thumb: "", art: "", kind: "song" },
      bytes,
      mime,
      cachedAt: Date.now(),
      lastPlayedAt: job.lastPlayedAt,
    };
    changed();
  }).finally(() => {
    jobs.delete(id);
    rmSync(part, { force: true });
  });
  jobs.set(id, job);
  return job.done;
}

export function listCached() {
  return Object.keys(entries()).flatMap((id) => {
    const entry = cachedAudio(id);
    return entry ? [entry] : [];
  }).sort((a, b) => b.cachedAt - a.cachedAt);
}

export function cacheStats() {
  const list = listCached();
  return { days: getSettings().cacheDays, count: list.length, bytes: list.reduce((total, entry) => total + entry.bytes, 0) };
}

export function pruneAudioCache() {
  const days = getSettings().cacheDays;
  if (!days) return;
  const cutoff = Date.now() - days * 86400_000;
  for (const entry of listCached()) {
    if ((entry.lastPlayedAt || entry.cachedAt) >= cutoff) continue;
    rmSync(entry.file, { force: true });
    delete entries()[entry.track.id];
    changed();
  }
}

export async function clearAudioCache() {
  const pending = [...jobs.values()];
  for (const job of pending) job.controller.abort();
  if (existsSync(dir)) {
    for (const name of readdirSync(dir)) {
      if (/^[\w-]{11}\.(m4a|webm)$/.test(name) || /^[\w-]{11}\.part$/.test(name) && !jobs.has(name.slice(0, 11))) {
        rmSync(path.join(dir, name), { force: true });
      }
    }
  }
  index = {};
  changed();
  flushAudioCache();
  await Promise.allSettled(pending.map((job) => job.done));
  return cacheStats();
}
