import { copyFile, mkdir } from "node:fs/promises";
import { existsSync, renameSync, rmSync, statSync } from "node:fs";
import path from "node:path";
import { audioExtension, cachedAudio, fetchAudio, pendingCache } from "./audioCache.js";
import { config } from "./config.js";
import { readJson, writeJson } from "./settings.js";
import type { Track } from "./types.js";

interface Entry {
  file: string;
  track: Track;
  bytes: number;
  downloadedAt: number;
}

interface Item {
  track: Track;
  status: "queued" | "downloading" | "done" | "error";
  progress: number;
  error?: string;
}

interface Job {
  item: Item;
  controller?: AbortController;
  done?: Promise<void>;
}

export const downloadDir = path.resolve(process.env.EARFUL_DOWNLOAD_DIR ?? path.join(config.dataDir, "downloads"));
const indexFile = path.join(config.dataDir, "downloads.json");
let index: Record<string, Entry> | undefined;
const entries = () => index ??= readJson<Record<string, Entry>>(indexFile, {});
const jobs = new Map<string, Job>();
let active = 0;

function save(id: string, entry?: Entry) {
  const updated = { ...entries() };
  if (entry) updated[id] = entry;
  else delete updated[id];
  writeJson(indexFile, updated);
  index = updated;
}

export function downloadedAudio(id: string) {
  const entry = entries()[id];
  if (!entry) return;
  if (!existsSync(entry.file)) {
    save(id);
    return;
  }
  return { ...entry, mime: entry.file.endsWith(".webm") ? "audio/webm" : "audio/mp4" };
}

export function listDownloaded() {
  return Object.keys(entries()).flatMap((id) => {
    const entry = downloadedAudio(id);
    return entry ? [entry] : [];
  }).sort((a, b) => b.downloadedAt - a.downloadedAt);
}

export function downloadStatus() {
  const items: Item[] = listDownloaded().map(({ track }) => ({ track, status: "done", progress: 1 }));
  return { dir: downloadDir, items: [...jobs.values()].map(({ item }) => item).concat(items) };
}

export function isDownloading(id: string) {
  const job = jobs.get(id);
  return job?.item.status === "queued" || job?.item.status === "downloading";
}

function fileName(track: Track, mime: string) {
  const suffix = ` [${track.id}].${audioExtension(mime)}`;
  const base = (track.artist ? `${track.artist} - ${track.title}` : track.title)
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_")
    .slice(0, 150 - suffix.length)
    .replace(/[. \uD800-\uDBFF]+$/u, "")
    .trim();
  const safe = /^(CON|PRN|AUX|NUL|COM[1-9¹²³]|LPT[1-9¹²³])\./i.test(base) ? "_" + base.slice(1) : base;
  return safe + suffix;
}

async function download(track: Track, signal: AbortSignal, progress: (value: number) => void) {
  const { id } = track;
  const part = path.join(downloadDir, id + ".part");
  await mkdir(downloadDir, { recursive: true });
  try {
    await pendingCache(id)?.catch(() => {});
    signal.throwIfAborted();
    const cached = cachedAudio(id);
    let mime: string | undefined;
    if (cached) {
      try {
        await copyFile(cached.file, part);
        mime = cached.mime;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
    }
    mime ??= (await fetchAudio(id, part, signal, progress)).audio.mime;
    signal.throwIfAborted();
    const file = path.join(downloadDir, fileName(track, mime));
    const bytes = statSync(part).size;
    renameSync(part, file);
    try {
      save(id, { file, track, bytes, downloadedAt: Date.now() });
    } catch (error) {
      rmSync(file, { force: true });
      throw error;
    }
  } finally {
    rmSync(part, { force: true });
  }
}

function pump() {
  for (const [id, job] of jobs) {
    if (active >= 2) return;
    if (job.item.status !== "queued") continue;
    active++;
    job.item.status = "downloading";
    const controller = job.controller = new AbortController();
    job.done = download(job.item.track, controller.signal, (progress) => { job.item.progress = progress; })
      .then(() => { jobs.delete(id); }, () => {
        if (controller.signal.aborted) jobs.delete(id);
        else job.item = { track: job.item.track, status: "error", progress: 0, error: "downloadFailed" };
      })
      .finally(() => {
        active--;
        pump();
      });
  }
}

export function enqueueDownloads(tracks: Track[]) {
  let queued = 0;
  for (const track of tracks) {
    if (downloadedAudio(track.id) || isDownloading(track.id)) continue;
    jobs.set(track.id, { item: { track, status: "queued", progress: 0 } });
    queued++;
  }
  pump();
  return { queued, skipped: tracks.length - queued };
}

export async function removeDownload(id: string) {
  const job = jobs.get(id);
  if (job?.controller && job.item.status === "downloading") {
    job.controller.abort();
    await job.done;
  } else {
    jobs.delete(id);
  }
  const entry = downloadedAudio(id);
  if (!entry) return;
  rmSync(entry.file, { force: true });
  save(id);
}
