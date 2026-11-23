import { Capacitor } from "@capacitor/core";
import { Directory, Encoding, Filesystem } from "@capacitor/filesystem";
import { Share } from "@capacitor/share";
import {
  album as albumPage,
  ALBUM_ID,
  artist as artistPage,
  ARTIST_ID,
  artistId,
  GENRE_ID,
  genre as genrePage,
  genreArtists,
  genres,
  searchAlbums,
} from "../../../server/src/browse";
import { msg, tr, type MsgKey } from "../../../server/src/i18n";
import { lyricsFor } from "../../../server/src/lyrics";
import * as library from "../../../server/src/library";
import { findVideoFor, radio, search, suggestions } from "../../../server/src/search";
import { HttpError, VIDEO_ID } from "../../../server/src/types";
import { getLang, getT } from "../i18n";
import { ApiError, cacheDaysOptions, type EarfulApi, type SystemInfo } from "../lib/apiTypes";
import { PLAYLIST_FILE_MIME } from "../lib/playlistFile";
import { Device } from "./android";
import { media } from "./media";
import * as offline from "./offline";
import { nativeStorage } from "./storage";
import { forgetUrl, resolveAudio } from "./streams";

// The Android backend: the Earful server's own code (search, genres, artists, albums, library), running on the
// phone instead of behind HTTP. The build swaps lib/api.ts for this module (see vite.config.ts).
export * from "../lib/apiTypes";
export { onExternalFile } from "./playlistFiles";

library.useLibraryStorage(nativeStorage);

const fail = (status: number, key: MsgKey) => new ApiError(status, tr(getLang(), msg(key)));

/** Runs a server function and turns its errors into what the app expects, in the app's language. */
async function call<T>(fn: () => Promise<T>, signal?: AbortSignal): Promise<T> {
  if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
  try {
    const result = await fn();
    // The work can't be cancelled midway, but a caller that gave up must not get the result.
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
    return result;
  } catch (e) {
    if (e instanceof HttpError) throw new ApiError(e.status, tr(getLang(), e.text), e.code);
    if (e instanceof ApiError || (e as Error).name === "AbortError") throw e;
    throw new ApiError(500, (e as Error).message || getT().player.serverDown);
  }
}

const tracks = (list: unknown[]) => list.slice(0, 500).map(library.sanitizeTrack);
const discordUnavailable = async () => ({ available: false, enabled: false, connected: false });

const SYSTEM: SystemInfo = {
  ytdlp: { path: "built-in", version: null, channel: "stable", latest: { stable: null, nightly: null }, updateAvailable: false },
  deno: "built-in",
  ffmpeg: null,
  canInstall: false,
  job: null,
};

export const api: EarfulApi = {
  search: (q, type, signal) =>
    call(async () => {
      if (!q.trim()) throw fail(400, "emptyQuery");
      return search(q.trim().slice(0, 200), type, getLang());
    }, signal),
  suggest: (q, signal) => call(() => suggestions(q.trim().slice(0, 100), getLang()).catch(() => []), signal),
  radio: (id) => call(() => radio(id)),
  genres: () => call(() => genres(getLang())),
  genre: (id, signal) =>
    call(async () => {
      if (!GENRE_ID.test(id)) throw fail(400, "invalidGenre");
      return genrePage(id, getLang());
    }, signal),
  genreArtists: (id, offset) => call(() => genreArtists(id, offset, getLang())),
  artistId: (name) => call(() => artistId(name, getLang())),
  lyrics: (track) => call(() => lyricsFor(track, getLang())),
  artist: (id, signal) =>
    call(async () => {
      if (!ARTIST_ID.test(id)) throw fail(400, "invalidArtist");
      return artistPage(id, getLang());
    }, signal),
  album: (id, signal) =>
    call(async () => {
      if (!ALBUM_ID.test(id)) throw fail(400, "invalidAlbum");
      return albumPage(id, getLang());
    }, signal),
  searchAlbums: (q, signal) => call(() => searchAlbums(q.trim().slice(0, 200), getLang()), signal),
  videoFor: (t) => call(() => findVideoFor(t.id, t.title, t.artist, t.duration)),
  prepare: (id, signal) =>
    call(async () => {
      if (!VIDEO_ID.test(id)) throw fail(400, "invalidVideoId");
      const r = (await offline.localAudio(id).catch(() => undefined))?.entry.track ?? await resolveAudio(id);
      return { id, title: r.title, duration: r.duration, hasSdVideo: false };
    }, signal),
  cachePlayed: (track) => call(async () => { await offline.cacheTrack(library.sanitizeTrack(track), true); }),
  cacheAhead: (track) => call(async () => { await offline.cacheTrack(library.sanitizeTrack(track), false); }),
  cacheStats: () => call(offline.cacheStats),
  setCacheDays: (days) => call(async () => {
    if (!cacheDaysOptions.includes(days)) throw fail(400, "invalidCacheDays");
    return offline.setCacheDays(days);
  }),
  clearCache: () => call(offline.clearCache),
  offline: () => call(offline.offline),
  downloads: () => call(offline.downloadStatus),
  download: (list) => call(() => offline.enqueueDownloads(list.map(library.sanitizeTrack))),
  removeDownload: (id) => call(async () => {
    if (!VIDEO_ID.test(id)) throw fail(400, "invalidVideoId");
    await offline.removeDownload(id);
  }),

  nowPlaying: async () => {},
  discordStatus: discordUnavailable,
  setDiscord: discordUnavailable,

  library: () => call(() => library.getLibrary()),
  addFavorite: (t) => call(async () => ({ favorites: await library.addFavorite(library.sanitizeTrack(t)) })),
  addFavorites: (list) => call(async () => ({ favorites: await library.addFavorites(tracks(list)) })),
  removeFavorite: (id) => call(async () => ({ favorites: await library.removeFavorite(id) })),
  pushHistory: (t) => call(async () => ({ history: await library.pushHistory(library.sanitizeTrack(t)) })),
  createPlaylist: (name, list = []) => call(() => library.createPlaylist(name, list.slice(0, 5000).map(library.sanitizeTrack))),
  renamePlaylist: (id, name) => call(() => library.renamePlaylist(id, name)),
  deletePlaylist: (id) => call(() => library.deletePlaylist(id)),
  addToPlaylist: (id, t) => call(() => library.addToPlaylist(id, Array.isArray(t) ? tracks(t) : library.sanitizeTrack(t))),
  removeFromPlaylist: (id, trackId) => call(() => library.removeFromPlaylist(id, trackId)),
  importLibrary: (backup, mode) =>
    call(async () => {
      const b = (backup ?? {}) as { format?: unknown; version?: unknown; library?: unknown };
      if (b.format !== "earful-backup") throw fail(400, "notBackup");
      if (typeof b.version !== "number" || b.version > 1) throw fail(400, "newerBackup");
      return library.importLibrary(b.library, mode);
    }),

  system: async () => SYSTEM,
  updateYtdlp: async () => {
    throw new ApiError(400, "yt-dlp isn't used on this device.");
  },
};

/** On the phone, the media element plays YouTube's stream directly: resolved here, no proxy needed. */
export async function streamSource(id: string, _kind?: "audio" | "video", _quality?: "sd" | "hd", ahead = false) {
  const hit = await offline.localAudio(id).catch(() => undefined);
  if (!hit) {
    if (ahead) throw fail(404, "noAudio");
    return (await resolveAudio(id)).url;
  }
  // AVPlayer opens the file directly. The WebView needs Capacitor's local HTTP endpoint.
  return !ahead && Capacitor.getPlatform() === "ios" ? hit.uri : Capacitor.convertFileSrc(hit.uri);
}

export async function explainStreamError(url: string): Promise<{ message: string }> {
  forgetUrl(url);
  return { message: navigator.onLine ? getT().player.streamFailed : getT().player.offline };
}

/** Backups are shared through Android's share sheet (save to Files, Drive, send to the computer…). */
export async function saveFile(name: string, text: string, mime?: string) {
  const { uri } = await Filesystem.writeFile({ path: name, data: text, directory: Directory.Cache, encoding: Encoding.UTF8 });
  if (mime === PLAYLIST_FILE_MIME && Capacitor.getPlatform() === "android") {
    return Device.sharePlaylist({ uri, title: name });
  }
  await Share.share({ title: name, files: [uri] });
}

export const systemMedia = media;

export const capabilities = { video: false, engineSettings: false, retryOnError: true };
