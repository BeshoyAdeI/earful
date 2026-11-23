import type { Track } from "./types.js";

export const PLAYLIST_FILE_MIME = "application/x-earful-playlist";
export const MAX_PLAYLIST_FILE_BYTES = 5 * 1024 * 1024;
const MAX_TRACKS = 5000;

export interface PlaylistFile {
  format: "earful-playlist";
  version: 1;
  /**
   * The playlist's own id. Opening a file whose id is already in the library updates that playlist instead of
   * adding a copy, so friends can keep sending each other the latest version. Files from before 1.6.2 have none.
   */
  id?: string;
  name: string;
  exportedAt: string;
  app: string;
  tracks: Track[];
}

export class PlaylistFileError extends Error {
  constructor(readonly reason: "invalid" | "tooLarge" | "tooManyTracks") {
    super(reason);
  }
}

/** Same rule as the server's library ids. */
export const PLAYLIST_ID = /^[\w-]{8,64}$/;

export function isPlaylistFileName(name: string) {
  return /\.earful$/i.test(name);
}

function checkSize(text: string) {
  if (text.length > MAX_PLAYLIST_FILE_BYTES || new TextEncoder().encode(text).length > MAX_PLAYLIST_FILE_BYTES) {
    throw new PlaylistFileError("tooLarge");
  }
}

function isArtwork(value: unknown): value is string {
  if (value === "") return true;
  if (typeof value !== "string" || !value.startsWith("https://")) return false;
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

function isTrack(value: unknown): value is Track {
  if (!value || typeof value !== "object") return false;
  const t = value as Partial<Track>;
  return typeof t.id === "string" && /^[A-Za-z0-9_-]{11}$/.test(t.id)
    && typeof t.title === "string" && typeof t.artist === "string"
    && (t.album === undefined || typeof t.album === "string")
    && typeof t.duration === "number" && Number.isFinite(t.duration) && t.duration >= 0
    && isArtwork(t.thumb) && isArtwork(t.art)
    && (t.kind === "song" || t.kind === "video");
}

export function parsePlaylistFile(data: unknown): PlaylistFile {
  let value: unknown;
  try {
    const text = typeof data === "string" ? data : JSON.stringify(data);
    if (typeof text !== "string") throw new PlaylistFileError("invalid");
    checkSize(text);
    value = JSON.parse(text.replace(/^\uFEFF/, ""));
  } catch (error) {
    throw error instanceof PlaylistFileError ? error : new PlaylistFileError("invalid");
  }

  if (!value || typeof value !== "object") throw new PlaylistFileError("invalid");
  const file = value as Partial<PlaylistFile>;
  if (file.format !== "earful-playlist" || file.version !== 1 || typeof file.name !== "string" || !file.name.trim()
    || typeof file.exportedAt !== "string" || !/^\d{4}-\d{2}-\d{2}T/.test(file.exportedAt)
    || !Number.isFinite(Date.parse(file.exportedAt)) || typeof file.app !== "string" || !file.app.trim()
    || !Array.isArray(file.tracks)) {
    throw new PlaylistFileError("invalid");
  }
  if (file.tracks.length > MAX_TRACKS) throw new PlaylistFileError("tooManyTracks");
  if (!file.tracks.every(isTrack)) throw new PlaylistFileError("invalid");

  const id = typeof file.id === "string" && PLAYLIST_ID.test(file.id) ? file.id : undefined;
  return { format: file.format, version: file.version, id, name: file.name.trim(), exportedAt: file.exportedAt, app: file.app, tracks: file.tracks };
}

export function serializePlaylistFile(name: string, tracks: Track[], version: string, id?: string): string {
  if (tracks.length > MAX_TRACKS) throw new PlaylistFileError("tooManyTracks");
  const file: PlaylistFile = {
    format: "earful-playlist",
    version: 1,
    ...(id && PLAYLIST_ID.test(id) ? { id } : {}),
    name: name.trim(),
    exportedAt: new Date().toISOString(),
    app: `Earful ${version}`,
    tracks,
  };
  const text = JSON.stringify(file);
  parsePlaylistFile(text);
  return text;
}
