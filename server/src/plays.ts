import { msg } from "./i18n.js";
import { sanitizeTrack } from "./library.js";
import { HttpError, VIDEO_ID } from "./types.js";

export interface PlayEvent {
  id: string;
  title: string;
  artist: string;
  artists?: { name: string; id?: string }[];
  album?: string;
  thumb: string;
  duration: number;
  at: number;
  sec: number;
}

export interface PlaysStorage {
  read(): Promise<string | null>;
  append(lines: string): Promise<void>;
  clear(): Promise<void>;
}

const LIMIT = 300_000;
let storage: PlaysStorage;
let cache: PlayEvent[] | undefined;
let oldest = 0;
let needsNewline = false;
let pending: Promise<unknown> = Promise.resolve();
/** Where each listen (song + start time) sits in the cache: a later report of the same listen replaces it. */
let positions = new Map<string, number>();
const listenKey = (e: PlayEvent) => `${e.id}@${e.at}`;

export function usePlaysStorage(s: PlaysStorage): void {
  storage = s;
  cache = undefined;
  oldest = 0;
  needsNewline = false;
  pending = Promise.resolve();
  positions = new Map();
}

function serialized<T>(work: () => Promise<T>): Promise<T> {
  const result = pending.then(work);
  pending = result.catch(() => {});
  return result;
}

function sanitize(input: unknown): PlayEvent {
  const e = (input ?? {}) as Partial<PlayEvent>;
  if (typeof e.id !== "string" || !VIDEO_ID.test(e.id) ||
    typeof e.at !== "number" || !Number.isFinite(e.at) || e.at < 0 || e.at > 8.64e15 - 86_400_000 ||
    typeof e.sec !== "number" || !Number.isFinite(e.sec) || e.sec < 10) {
    throw new HttpError(400, msg("invalidPlay"));
  }
  const { id, title, artist, artists, album, thumb, duration } = sanitizeTrack(e);
  return { id, title, artist, artists, album, thumb, duration: Math.min(duration, 86_400), at: Math.trunc(e.at), sec: Math.min(e.sec, 86_400) };
}

function add(events: PlayEvent[], event: PlayEvent) {
  const key = listenKey(event);
  const at = positions.get(key);
  // The same listen reported again (the app was minimized mid-song, then the song finished): keep the longer one.
  if (at !== undefined && events[at] && listenKey(events[at]!) === key) {
    if (event.sec > events[at]!.sec) events[at] = event;
    return;
  }
  if (events.length < LIMIT) {
    positions.set(key, events.length);
    events.push(event);
  } else {
    positions.delete(listenKey(events[oldest]!));
    positions.set(key, oldest);
    events[oldest] = event;
    oldest = (oldest + 1) % LIMIT;
  }
}

async function load(): Promise<PlayEvent[]> {
  if (cache) return cache;
  const jsonl = await storage.read();
  const events: PlayEvent[] = [];
  positions = new Map();
  // Scan without creating a second array of every line in the file.
  if (jsonl) {
    needsNewline = !jsonl.endsWith("\n");
    const latest = Date.now() + 3_600_000;
    let start = 0;
    while (start < jsonl.length) {
      const end = jsonl.indexOf("\n", start);
      try {
        const event = sanitize(JSON.parse(jsonl.slice(start, end < 0 ? undefined : end)));
        if (event.at <= latest) add(events, event);
      } catch {
        // A partial or corrupt line should not make the rest of the log unreadable.
      }
      if (end < 0) break;
      start = end + 1;
    }
  }
  cache = events;
  return events;
}

export async function recordPlay(input: unknown): Promise<void> {
  const event = sanitize(input);
  const now = Date.now();
  const cutoff = new Date(now);
  cutoff.setUTCFullYear(cutoff.getUTCFullYear() - 2);
  if (event.at < cutoff.getTime() || event.at > now + 3_600_000) throw new HttpError(400, msg("invalidPlay"));
  await serialized(async () => {
    const events = await load();
    const line = (needsNewline ? "\n" : "") + JSON.stringify(event) + "\n";
    // If a write leaves a partial line behind, the next event starts on a fresh line.
    needsNewline = true;
    await storage.append(line);
    needsNewline = false;
    add(events, event);
  });
}

export function allPlays(): Promise<PlayEvent[]> {
  return serialized(async () => {
    const events = await load();
    return oldest ? events.slice(oldest).concat(events.slice(0, oldest)) : events;
  });
}

export function clearPlays(): Promise<void> {
  return serialized(async () => {
    await storage.clear();
    cache = [];
    positions = new Map();
    oldest = 0;
    needsNewline = false;
  });
}
