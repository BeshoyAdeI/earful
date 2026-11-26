import { msg } from "./i18n.js";
import { ARTIST_ID, HttpError, VIDEO_ID, type Library, type LibraryStamps, type Playlist, type Track } from "./types.js";

// No Node-only imports here: the Android app runs this same module, with its own storage.

const HISTORY_LIMIT = 60;

/** Where the library is kept: a file on the server and the desktop app, app storage on Android. */
export interface LibraryStorage {
  read(): Promise<string | null>;
  write(json: string): Promise<void>;
}

let storage: LibraryStorage | null = null;
let state: Library | null = null;
let writeChain: Promise<void> = Promise.resolve();

/** Set once at startup, before any request. */
export function useLibraryStorage(s: LibraryStorage) {
  storage = s;
  state = null;
}

const randomUUID = () => globalThis.crypto.randomUUID();

async function load(): Promise<Library> {
  if (state) return state;
  if (!storage) throw new Error("Library storage not configured");
  const json = await storage.read();
  return (state ??= json ? (JSON.parse(json) as Library) : { favorites: [], playlists: [], history: [] });
}

/** Serialized writes so concurrent requests never interleave. */
function persist(): Promise<void> {
  const snapshot = JSON.stringify(state, null, 2);
  writeChain = writeChain.then(() => storage!.write(snapshot));
  return writeChain;
}

const str = (v: unknown, max: number) => (typeof v === "string" ? v.slice(0, max) : "");

export function sanitizeTrack(input: unknown): Track {
  const t = (input ?? {}) as Record<string, unknown>;
  const id = str(t.id, 11);
  if (!VIDEO_ID.test(id)) throw new HttpError(400, msg("invalidTrack"));
  const url = (v: unknown) => {
    const s = str(v, 500);
    return /^https:\/\//.test(s) ? s : "";
  };
  const artists = Array.isArray(t.artists) ? t.artists.slice(0, 10).flatMap((artist) => {
    if (!artist || typeof artist.name !== "string") return [];
    const name = artist.name.trim();
    if (!name || name.length > 200) return [];
    const id = typeof artist.id === "string" && ARTIST_ID.test(artist.id) ? artist.id : undefined;
    return [{ name, id }];
  }) : undefined;
  return {
    id,
    title: str(t.title, 300) || "Untitled",
    artist: str(t.artist, 300),
    artists: artists?.length ? artists : undefined,
    album: str(t.album, 300) || undefined,
    duration: typeof t.duration === "number" && Number.isFinite(t.duration) ? Math.max(0, Math.round(t.duration)) : 0,
    thumb: url(t.thumb),
    art: url(t.art),
    kind: t.kind === "video" ? "video" : "song",
  };
}

/** Notes the time of a change, for merging with another copy of the library (see mergeLibraries). */
function stamp(lib: Library, kind: keyof LibraryStamps, id: string, at = Date.now()) {
  const stamps = (lib.stamps ??= {});
  (stamps[kind] ??= {})[id] = at;
}

function findPlaylist(lib: Library, pid: string): Playlist {
  const p = lib.playlists.find((x) => x.id === pid);
  if (!p) throw new HttpError(404, msg("playlistNotFound"));
  return p;
}

export async function getLibrary(): Promise<Library> {
  return load();
}

export async function addFavorite(track: Track): Promise<Track[]> {
  const lib = await load();
  lib.favorites = [track, ...lib.favorites.filter((t) => t.id !== track.id)];
  stamp(lib, "favoriteAdded", track.id);
  await persist();
  return lib.favorites;
}

/** Adds many at once (in the given order, on top), skipping ones already there. */
export async function addFavorites(tracks: Track[]): Promise<Track[]> {
  const lib = await load();
  const seen = new Set(lib.favorites.map((t) => t.id));
  const added = tracks.filter((t) => !seen.has(t.id) && !!seen.add(t.id));
  lib.favorites = [...added, ...lib.favorites];
  const now = Date.now();
  // Later in the list = added earlier, so a merge keeps this order.
  added.forEach((t, i) => stamp(lib, "favoriteAdded", t.id, now - i));
  await persist();
  return lib.favorites;
}

export async function removeFavorite(id: string): Promise<Track[]> {
  const lib = await load();
  lib.favorites = lib.favorites.filter((t) => t.id !== id);
  stamp(lib, "favoriteRemoved", id);
  await persist();
  return lib.favorites;
}

export async function pushHistory(track: Track): Promise<Track[]> {
  const lib = await load();
  lib.history = [track, ...lib.history.filter((t) => t.id !== track.id)].slice(0, HISTORY_LIMIT);
  await persist();
  return lib.history;
}

export const PLAYLIST_ID = /^[\w-]{8,64}$/;

/**
 * `id`: keep the id a shared .earful file carries, so a later copy of the same playlist updates this one instead
 * of adding another. Ignored when invalid or already taken.
 */
export async function createPlaylist(name: string, tracks: Track[] = [], id?: string): Promise<Playlist> {
  const lib = await load();
  const clean = name.trim().slice(0, 80);
  if (!clean) throw new HttpError(400, msg("playlistNameRequired"));
  const now = Date.now();
  const keep = typeof id === "string" && PLAYLIST_ID.test(id) && !lib.playlists.some((p) => p.id === id);
  const playlist: Playlist = { id: keep ? id : randomUUID(), name: clean, createdAt: now, updatedAt: now, tracks };
  lib.playlists.unshift(playlist);
  await persist();
  return playlist;
}

export async function renamePlaylist(pid: string, name: string): Promise<Playlist> {
  const lib = await load();
  const p = findPlaylist(lib, pid);
  const clean = name.trim().slice(0, 80);
  if (!clean) throw new HttpError(400, msg("playlistNameRequired"));
  p.name = clean;
  p.updatedAt = Date.now();
  await persist();
  return p;
}

export async function deletePlaylist(pid: string): Promise<void> {
  const lib = await load();
  findPlaylist(lib, pid);
  lib.playlists = lib.playlists.filter((p) => p.id !== pid);
  stamp(lib, "playlistRemoved", pid);
  await persist();
}

export async function addToPlaylist(pid: string, tracks: Track | Track[]): Promise<Playlist> {
  const lib = await load();
  const p = findPlaylist(lib, pid);
  for (const track of Array.isArray(tracks) ? tracks : [tracks]) {
    if (!p.tracks.some((t) => t.id === track.id)) p.tracks.push(track);
  }
  p.updatedAt = Date.now();
  await persist();
  return p;
}

export async function removeFromPlaylist(pid: string, trackId: string): Promise<Playlist> {
  const lib = await load();
  const p = findPlaylist(lib, pid);
  p.tracks = p.tracks.filter((t) => t.id !== trackId);
  p.updatedAt = Date.now();
  await persist();
  return p;
}

// Backup import: a library exported from any Earful instance (web, desktop, another computer).

const MAX_PLAYLISTS = 1000;
const MAX_TRACKS = 5000;

/** Keeps the valid tracks of an untrusted list, without duplicates. */
function cleanTracks(input: unknown, limit = MAX_TRACKS): Track[] {
  if (!Array.isArray(input)) return [];
  const seen = new Set<string>();
  const out: Track[] = [];
  for (const raw of input.slice(0, limit * 2)) {
    try {
      const t = sanitizeTrack(raw);
      if (seen.has(t.id)) continue;
      seen.add(t.id);
      out.push(t);
      if (out.length >= limit) break;
    } catch {
      // skip invalid entries instead of rejecting the whole backup
    }
  }
  return out;
}

function cleanLibrary(input: unknown): Library {
  const lib = (input ?? {}) as Record<string, unknown>;
  const playlists = (Array.isArray(lib.playlists) ? lib.playlists : []).slice(0, MAX_PLAYLISTS).flatMap((raw): Playlist[] => {
    const p = (raw ?? {}) as Record<string, unknown>;
    const name = str(p.name, 80).trim();
    if (!name) return [];
    const now = Date.now();
    const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : now);
    const id = str(p.id, 64);
    return [{ id: PLAYLIST_ID.test(id) ? id : randomUUID(), name, createdAt: num(p.createdAt), updatedAt: num(p.updatedAt), tracks: cleanTracks(p.tracks) }];
  });
  return { favorites: cleanTracks(lib.favorites), playlists, history: cleanTracks(lib.history, HISTORY_LIMIT) };
}

export interface ImportResult {
  playlistsAdded: number;
  playlistsMerged: number;
  tracksAdded: number;
  favoritesAdded: number;
}

/**
 * "merge" adds what is missing and never deletes (playlists match by id, then by name).
 * "replace" swaps the whole library for the backup's.
 */
export async function importLibrary(input: unknown, mode: "merge" | "replace"): Promise<ImportResult> {
  const incoming = cleanLibrary(input);
  const lib = await load();
  const result: ImportResult = { playlistsAdded: 0, playlistsMerged: 0, tracksAdded: 0, favoritesAdded: 0 };

  if (mode === "replace") {
    state = incoming;
    result.playlistsAdded = incoming.playlists.length;
    result.favoritesAdded = incoming.favorites.length;
    result.tracksAdded = incoming.playlists.reduce((n, p) => n + p.tracks.length, 0);
    await persist();
    return result;
  }

  const union = (mine: Track[], theirs: Track[]) => {
    const have = new Set(mine.map((t) => t.id));
    const added = theirs.filter((t) => !have.has(t.id));
    return { list: [...mine, ...added], added: added.length };
  };

  const fav = union(lib.favorites, incoming.favorites);
  lib.favorites = fav.list;
  result.favoritesAdded = fav.added;

  for (const p of incoming.playlists) {
    const match =
      lib.playlists.find((x) => x.id === p.id) ??
      lib.playlists.find((x) => x.name.toLocaleLowerCase("pt-BR") === p.name.toLocaleLowerCase("pt-BR"));
    if (match) {
      const merged = union(match.tracks, p.tracks);
      if (!merged.added) continue; // already had every track: nothing changed
      match.tracks = merged.list.slice(0, MAX_TRACKS);
      match.updatedAt = Date.now();
      result.tracksAdded += merged.added;
      result.playlistsMerged++;
    } else {
      lib.playlists.push(p);
      result.tracksAdded += p.tracks.length;
      result.playlistsAdded++;
    }
  }

  lib.history = union(lib.history, incoming.history).list.slice(0, HISTORY_LIMIT);
  await persist();
  return result;
}

// Sync: two copies of the library (the phone's and the PC's) merged into one, the same result on both sides.

const MAX_STAMPS = 20_000;

function cleanStampMap(input: unknown, key: RegExp): Record<string, number> {
  const out: Record<string, number> = {};
  if (!input || typeof input !== "object") return out;
  let n = 0;
  for (const [id, at] of Object.entries(input as Record<string, unknown>)) {
    if (n >= MAX_STAMPS) break;
    if (!key.test(id) || typeof at !== "number" || !Number.isFinite(at) || at < 0) continue;
    out[id] = Math.trunc(at);
    n++;
  }
  return out;
}

function cleanStamps(input: unknown): LibraryStamps {
  const s = (input ?? {}) as Record<string, unknown>;
  return {
    favoriteAdded: cleanStampMap(s.favoriteAdded, VIDEO_ID),
    favoriteRemoved: cleanStampMap(s.favoriteRemoved, VIDEO_ID),
    playlistRemoved: cleanStampMap(s.playlistRemoved, PLAYLIST_ID),
  };
}

/** The later of each time in two maps. */
function latest(a: Record<string, number> = {}, b: Record<string, number> = {}): Record<string, number> {
  const out = { ...a };
  for (const [id, at] of Object.entries(b)) if (!(id in out) || at > out[id]!) out[id] = at;
  return out;
}

/**
 * Merges two copies of a library; the result doesn't depend on which one is "local".
 * - Favorites: the latest change per song wins (added or removed). Songs favorited before stamps existed count as
 *   added long ago, so a removal on the other side still applies.
 * - Playlists: the copy changed last wins, whole (name and songs); a deletion wins over changes made before it.
 * - Recently played: both lists, this one first.
 */
export function mergeLibraries(local: Library, remote: Library): Library {
  const added = latest(local.stamps?.favoriteAdded, remote.stamps?.favoriteAdded);
  const removed = latest(local.stamps?.favoriteRemoved, remote.stamps?.favoriteRemoved);
  const playlistRemoved = latest(local.stamps?.playlistRemoved, remote.stamps?.playlistRemoved);

  const favorites: { track: Track; at: number; order: number }[] = [];
  const seenFav = new Set<string>();
  [...local.favorites, ...remote.favorites].forEach((track, order) => {
    if (seenFav.has(track.id)) return;
    seenFav.add(track.id);
    const at = added[track.id] ?? 0;
    if ((removed[track.id] ?? -1) >= at && removed[track.id] !== undefined) return;
    favorites.push({ track, at, order });
  });
  favorites.sort((a, b) => b.at - a.at || a.order - b.order);

  const remoteById = new Map(remote.playlists.map((p) => [p.id, p]));
  const playlists: Playlist[] = [];
  const seenList = new Set<string>();
  for (const mine of local.playlists) {
    const theirs = remoteById.get(mine.id);
    const winner = theirs && theirs.updatedAt > mine.updatedAt ? theirs : mine;
    seenList.add(mine.id);
    if ((playlistRemoved[mine.id] ?? -1) >= winner.updatedAt) continue;
    playlists.push(winner);
  }
  for (const theirs of remote.playlists) {
    if (seenList.has(theirs.id)) continue;
    seenList.add(theirs.id);
    if ((playlistRemoved[theirs.id] ?? -1) >= theirs.updatedAt) continue;
    playlists.push(theirs);
  }

  const seenHistory = new Set<string>();
  const history = [...local.history, ...remote.history].filter((t) => !seenHistory.has(t.id) && !!seenHistory.add(t.id)).slice(0, HISTORY_LIMIT);

  return {
    favorites: favorites.map((f) => f.track),
    playlists,
    history,
    stamps: { favoriteAdded: added, favoriteRemoved: removed, playlistRemoved },
  };
}

/** Merges and saves the library, counting the favorites and playlists changed locally. */
export async function syncLibrary(input: unknown) {
  const incoming = cleanLibrary(input);
  incoming.stamps = cleanStamps((input as { stamps?: unknown } | null)?.stamps);
  await load();
  // Another sync may have merged while this one was waiting for storage.
  const before = state!;
  const library = mergeLibraries(before, incoming);
  const favoriteIds = new Set(before.favorites.map(({ id }) => id));
  const playlistTimes = new Map(before.playlists.map(({ id, updatedAt }) => [id, updatedAt]));
  let favorites = 0;
  let playlists = 0;
  for (const { id } of library.favorites) {
    if (!favoriteIds.delete(id)) favorites++;
  }
  for (const { id, updatedAt } of library.playlists) {
    if (playlistTimes.get(id) !== updatedAt) playlists++;
    playlistTimes.delete(id);
  }
  const changed = { favorites: favorites + favoriteIds.size, playlists: playlists + playlistTimes.size };
  state = library;
  await persist();
  return { library, changed };
}
