import { getLang, getT } from "../i18n";
import {
  ApiError,
  type Channel,
  type ErrorCode,
  type DiscordStatus,
  type ExternalFileHandler,
  type ImportResult,
  type EarfulApi,
  type Prepared,
  type SystemInfo,
  type SystemJob,
  type SystemMedia,
  type SyncStatus,
  type PlayEvent,
} from "./apiTypes";
import type { AlbumCard, AlbumPage, ArtistPage, ArtistSongs, Genre, GenreArtist, GenrePage, Library, Lyrics, Playlist, Track } from "./types";

// The HTTP backend: the Earful server (web app, desktop app). The Android build swaps this module for native/api.ts.
export * from "./apiTypes";

/** The server answers errors (and YouTube Music answers names, like genres) in the app's language. */
const LANG_HEADER = "x-earful-lang";

async function request<T>(path: string, init?: RequestInit & { json?: unknown }): Promise<T> {
  const { json, ...rest } = init ?? {};
  const res = await fetch(path, {
    ...rest,
    headers: {
      [LANG_HEADER]: getLang(),
      ...(json !== undefined ? { "content-type": "application/json" } : {}),
      ...(rest.headers as Record<string, string> | undefined),
    },
    body: json !== undefined ? JSON.stringify(json) : rest.body,
  });
  if (res.status === 204) return undefined as T;
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, body.error ?? getT().player.httpError(res.status), body.code);
  return body as T;
}

export const api: EarfulApi = {
  search: (q: string, type: "song" | "video", signal?: AbortSignal) =>
    request<{ tracks: Track[] }>(`/api/search?q=${encodeURIComponent(q)}&type=${type}`, { signal }).then((r) => r.tracks),
  suggest: (q: string, signal?: AbortSignal) =>
    request<{ suggestions: string[] }>(`/api/suggest?q=${encodeURIComponent(q)}`, { signal }).then((r) => r.suggestions),
  radio: (id: string) => request<{ tracks: Track[] }>(`/api/radio/${id}`).then((r) => r.tracks),
  genres: () => request<{ genres: Genre[] }>("/api/genres").then((r) => r.genres),
  genre: (id: string, signal?: AbortSignal) => request<GenrePage>(`/api/genres/${encodeURIComponent(id)}`, { signal }),
  genreArtists: (id: string, offset: number) =>
    request<{ artists: GenreArtist[]; hasMore: boolean }>(`/api/genres/${encodeURIComponent(id)}/artists?offset=${offset}`),
  artistId: (name) => request<{ id: string | null }>(`/api/artist-id?name=${encodeURIComponent(name)}`).then((r) => r.id),
  lyrics: (track) => {
    const { id, title, artist, album, duration } = track;
    const params = new URLSearchParams({ title, artist, album: album ?? "", duration: String(duration) });
    return request<Lyrics>(`/api/lyrics/${encodeURIComponent(id)}?${params}`).catch((error) => {
      if (error instanceof ApiError && error.status === 404) return null;
      throw error;
    });
  },
  artist: (id: string, signal?: AbortSignal) => request<ArtistPage>(`/api/artists/${encodeURIComponent(id)}`, { signal }),
  artistSongs: (id: string, offset: number, signal?: AbortSignal) =>
    request<ArtistSongs>(`/api/artists/${encodeURIComponent(id)}/songs?offset=${offset}`, { signal }),
  album: (id: string, signal?: AbortSignal) => request<AlbumPage>(`/api/albums/${encodeURIComponent(id)}`, { signal }),
  searchAlbums: (q: string, signal?: AbortSignal) =>
    request<{ albums: AlbumCard[] }>(`/api/search/albums?q=${encodeURIComponent(q)}`, { signal }).then((r) => r.albums),
  /** The music video matching a song, or null when YouTube has none. */
  videoFor: (t: Track) =>
    request<{ track: Track | null }>(
      `/api/video-for/${t.id}?${new URLSearchParams({ title: t.title, artist: t.artist, duration: String(t.duration || "") })}`,
    ).then((r) => r.track),
  prepare: (id: string, signal?: AbortSignal, audioOnly?: boolean) =>
    request<Prepared>(`/api/prepare/${id}${audioOnly ? "?audio=1" : ""}`, {
      method: "POST",
      signal,
    }),
  cachePlayed: (track) => request(`/api/cache/${track.id}?wait=1`, { method: "POST", json: track }),
  cacheAhead: (track) => request(`/api/cache/${track.id}?ahead=1`, { method: "POST", json: track }),
  cacheStats: () => request("/api/cache"),
  setCacheDays: (days) => request("/api/cache", { method: "PUT", json: { days } }),
  clearCache: () => request("/api/cache", { method: "DELETE" }),
  offline: () => request("/api/offline"),
  downloads: () => request("/api/downloads"),
  download: (tracks) => request("/api/downloads", { method: "POST", json: { tracks } }),
  removeDownload: (id) => request(`/api/downloads/${id}`, { method: "DELETE" }),

  nowPlaying: (playing) => request<void>("/api/now-playing", { method: "POST", json: playing, keepalive: true }),
  discordStatus: () => request<DiscordStatus>("/api/discord"),
  setDiscord: (enabled) => request<DiscordStatus>("/api/discord", { method: "PUT", json: { enabled } }),

  recordPlay: (event) => request("/api/plays", { method: "POST", json: event, keepalive: true }),
  recordPlayBeacon: (event) => navigator.sendBeacon?.("/api/plays", new Blob([JSON.stringify(event)], { type: "text/plain" })) ?? false,
  stats: ({ from, to, tzOffsetMin, top }, signal) => {
    const params = new URLSearchParams({ tz: String(tzOffsetMin) });
    if (top) params.set("top", String(top));
    if (from !== null) params.set("from", String(from));
    if (to !== null) params.set("to", String(to));
    return request(`/api/stats?${params}`, { signal });
  },
  clearPlays: () => request("/api/plays", { method: "DELETE" }),
  allPlays: () => request<{ plays: PlayEvent[] }>("/api/plays").then((r) => r.plays),
  syncHost: {
    status: () => request<SyncStatus>("/api/sync"),
    setEnabled: (enabled) => request<SyncStatus>("/api/sync", { method: "PUT", json: { enabled } }),
    newCode: () => request<SyncStatus>("/api/sync/code", { method: "POST" }),
  },
  imageSrc: (url) => `/api/image?${new URLSearchParams({ u: url })}`,
  saveImage: downloadBlob,
  canShareImage: async (name, blob) => typeof navigator.share === "function" &&
    !!navigator.canShare?.({ files: [imageFile(name, blob)] }),
  shareImage: async (name, blob, text) => {
    await navigator.share({ files: [imageFile(name, blob)], text });
  },

  library: () => request<Library>("/api/library"),
  addFavorite: (t: Track) => request<{ favorites: Track[] }>(`/api/favorites/${t.id}`, { method: "PUT", json: t }),
  addFavorites: (tracks: Track[]) => request<{ favorites: Track[] }>("/api/favorites", { method: "POST", json: { tracks } }),
  removeFavorite: (id: string) => request<{ favorites: Track[] }>(`/api/favorites/${id}`, { method: "DELETE" }),
  pushHistory: (t: Track) => request<{ history: Track[] }>("/api/history", { method: "POST", json: t }),
  createPlaylist: (name: string, tracks: Track[] = [], id?: string) =>
    request<Playlist>("/api/playlists", { method: "POST", json: { name, tracks, id } }),
  renamePlaylist: (id: string, name: string) => request<Playlist>(`/api/playlists/${id}`, { method: "PATCH", json: { name } }),
  deletePlaylist: (id: string) => request<void>(`/api/playlists/${id}`, { method: "DELETE" }),
  addToPlaylist: (id: string, t: Track | Track[]) =>
    request<Playlist>(`/api/playlists/${id}/tracks`, { method: "POST", json: Array.isArray(t) ? { tracks: t } : t }),
  removeFromPlaylist: (id: string, trackId: string) =>
    request<Playlist>(`/api/playlists/${id}/tracks/${trackId}`, { method: "DELETE" }),

  importLibrary: (backup: unknown, mode: "merge" | "replace") =>
    request<ImportResult>("/api/library/import", { method: "POST", json: { backup, mode } }),

  system: () => request<SystemInfo>("/api/system"),
  updateYtdlp: (channel: Channel) => request<SystemJob>("/api/system/ytdlp", { method: "POST", json: { channel } }),
};

/** What a media element plays for a track: here, the server's stream proxy. The Android backend resolves it on the phone. */
export const streamSource = (id: string, kind: "audio" | "video", quality: "sd" | "hd", ahead = false): string | Promise<string> =>
  kind === "audio" ? `/api/stream/${id}/audio${ahead ? "?ahead=1" : ""}` : `/api/stream/${id}/video?q=${quality}`;

/** Saves a text file the way this platform does it: a browser download (the desktop app shows "Save as"). */
export async function saveFile(name: string, text: string, mime = "application/json") {
  await downloadBlob(name, new Blob([text], { type: mime }));
}

function imageFile(name: string, blob: Blob): File {
  return new File([blob], name, { type: "image/png" });
}

async function downloadBlob(name: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement("a"), { href: url, download: name });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export function onExternalFile(_handler: ExternalFileHandler): () => void {
  return () => {};
}

/** Only the Android app needs its own bridge to the system's media controls. */
export const systemMedia: SystemMedia | null = null;

/**
 * What this build can do. The Android build plays SD video only (no ffmpeg for HD) and has no yt-dlp to manage. Every
 * build retries a stream that fails once from the same spot: a passing hiccup otherwise skipped a song that plays fine
 * a moment later.
 */
export const capabilities = { video: true, hdVideo: true, engineSettings: true, retryOnError: true };

/** Media elements hide the HTTP error body; fetch it to show the real reason. */
export async function explainStreamError(url: string): Promise<{ message: string; code?: ErrorCode }> {
  const t = getT();
  try {
    const res = await fetch(url, { headers: { Range: "bytes=0-0", [LANG_HEADER]: getLang() } });
    if (res.ok) return { message: t.player.browserCantPlay };
    const body = await res.json().catch(() => ({}));
    return { message: body.error ?? t.player.httpError(res.status), code: body.code };
  } catch {
    return { message: t.player.serverDown };
  }
}
