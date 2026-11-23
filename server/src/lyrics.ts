import { config } from "./config.js";
import { msg, type Lang } from "./i18n.js";
import { text, withClient } from "./search.js";
import { HttpError, type Track } from "./types.js";

export interface LyricLine {
  time: number;
  text: string;
}

export interface Lyrics {
  source: "lrclib" | "youtube";
  synced: LyricLine[] | null;
  plain: string | null;
  instrumental?: boolean;
}

type LyricsTrack = Pick<Track, "id" | "title" | "artist" | "album" | "duration">;

interface LrcRecord {
  duration: number;
  instrumental: boolean;
  plainLyrics: string | null;
  syncedLyrics: string | null;
}

const MISS_TTL = 10 * 60_000;
const cache = new Map<string, { value: Promise<Lyrics | null>; expires: number }>();

function cleanTitle(title: string): string {
  return title
    .replace(/\s*[([](?:feat\.?|ft\.?)\s+[^)\]]*[)\]]/gi, "")
    .replace(/\s*[([]official\s+(?:(?:music|lyric)\s+)?(?:video|audio)[)\]]/gi, "")
    .replace(/\s*(?:[-–—]\s*|[([])(?:remaster(?:ed)?(?:\s+\d{4})?|\d{4}\s+remaster(?:ed)?)[)\]]?\s*$/i, "")
    .trim();
}

function parseLrc(lrc: string): LyricLine[] {
  const lines: LyricLine[] = [];
  for (const row of lrc.split(/\r?\n/)) {
    const tags = row.match(/^\s*(?:\[\d+:[0-5]\d(?:\.\d+)?\])+/)?.[0];
    if (!tags) continue;
    const text = row.slice(tags.length).trim();
    for (const [, minutes, seconds] of tags.matchAll(/\[(\d+):([0-5]\d(?:\.\d+)?)\]/g)) {
      lines.push({ time: Number(minutes) * 60 + Number(seconds), text });
    }
  }
  return lines.sort((a, b) => a.time - b.time);
}

function fromRecord(record: LrcRecord): Lyrics | null {
  if (record.instrumental) return { source: "lrclib", synced: null, plain: null, instrumental: true };
  const lines = parseLrc(record.syncedLyrics ?? "");
  const plain = record.plainLyrics?.trim() || null;
  const synced = lines.some((line) => line.text) ? lines : null;
  return synced || plain ? { source: "lrclib", synced, plain } : null;
}

const lrcFetch = (endpoint: string, params: URLSearchParams) =>
  (config.fetch ?? fetch)(`https://lrclib.net/api/${endpoint}?${params}`, {
    headers: { "User-Agent": "Earful (https://github.com/BeshoyAdeI/earful)" },
    signal: AbortSignal.timeout(8_000),
  });

async function lrclib(t: LyricsTrack): Promise<Lyrics | null> {
  const title = cleanTitle(t.title);
  const artist = t.artist.split(",")[0].trim();
  if (!title || !artist) return null;
  const search = new URLSearchParams({ track_name: title, artist_name: artist });
  const exact = new URLSearchParams(search);
  if (t.album) exact.set("album_name", t.album);
  const duration = Math.round(t.duration);
  if (duration >= 1 && duration <= 3600) exact.set("duration", String(duration));
  const result = await lrcFetch("get", exact);
  if (result.ok) return fromRecord(await result.json() as LrcRecord);
  if (result.status !== 404) throw new Error(`LRCLIB HTTP ${result.status}`);
  if (!(duration > 0)) return null;
  const response = await lrcFetch("search", search);
  if (!response.ok) throw new Error(`LRCLIB HTTP ${response.status}`);
  const records = await response.json() as LrcRecord[];
  const matches = records
    .filter((record) => Math.abs(record.duration - t.duration) <= 3)
    .sort((a, b) => Number(!!b.syncedLyrics) - Number(!!a.syncedLyrics)
      || Math.abs(a.duration - t.duration) - Math.abs(b.duration - t.duration));
  for (const record of matches) {
    const lyrics = fromRecord(record);
    if (lyrics) return lyrics;
  }
  return null;
}

async function load(t: LyricsTrack, lang: Lang): Promise<Lyrics | null> {
  let lrclibFailed = false;
  const first = await lrclib(t).catch(() => {
    lrclibFailed = true;
    return null;
  });
  if (first) return first;
  const plain = await withClient(async (yt) => {
    try {
      return text((await yt.music.getLyrics(t.id))?.description).trim();
    } catch (error) {
      // youtubei.js uses the video ID as error info when the lyrics page returns a message.
      const e = error as { message?: string; info?: unknown };
      if (e.info === t.id || e.message === "Could not find target tab.") return "";
      throw error;
    }
  }, lang).catch(() => {
    throw new HttpError(502, msg("lyricsUnavailable"));
  });
  if (plain) return { source: "youtube", synced: null, plain };
  if (lrclibFailed) throw new HttpError(502, msg("lyricsUnavailable"));
  return null;
}

export async function lyricsFor(t: LyricsTrack, lang: Lang): Promise<Lyrics | null> {
  const hit = cache.get(t.id);
  cache.delete(t.id);
  if (hit && hit.expires > Date.now()) {
    cache.set(t.id, hit);
    return hit.value;
  }
  const entry = { value: load(t, lang), expires: Infinity };
  cache.set(t.id, entry);
  if (cache.size > 300) cache.delete(cache.keys().next().value!);
  entry.value.then(
    (lyrics) => { if (!lyrics) entry.expires = Date.now() + MISS_TTL; },
    () => { if (cache.get(t.id) === entry) cache.delete(t.id); },
  );
  return entry.value;
}
