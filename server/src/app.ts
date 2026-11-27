import { existsSync } from "node:fs";
import { createServer } from "node:net";
import fastifyStatic from "@fastify/static";
import Fastify from "fastify";
import { cacheAudio, cacheStats, cachedAudio, clearAudioCache, flushAudioCache, listCached, pruneAudioCache } from "./audioCache.js";
import { ALBUM_ID, album, ARTIST_ID, artist, artistId, artistSongs, GENRE_ID, genre, genreArtists, genres, searchAlbums } from "./browse.js";
import { config } from "./config.js";
import { downloadedAudio, downloadStatus, enqueueDownloads, isDownloading, listDownloaded, removeDownload } from "./downloads.js";
import { lyricsFor } from "./lyrics.js";
import { createDiscordPresence } from "./discord.js";
import * as library from "./library.js";
import { fileStorage } from "./libraryFile.js";
import { coverUrl, isCoverType, MAX_COVER_BYTES } from "./image.js";
import { allPlays, clearPlays, mergePlays, recordPlay, usePlaysStorage } from "./plays.js";
import { newSyncCode, setSyncEnabled, startSyncIfEnabled, syncStatus } from "./syncServer.js";
import { playsFileStorage } from "./playsFile.js";
import { computeStats, MAX_TOP } from "./stats.js";
import { findVideoFor, radio, search, suggestions } from "./search.js";
import { getSettings, isCacheDays, updateSettings } from "./settings.js";
import { proxyStream, serveFile } from "./stream.js";
import { langOf, msg, tr } from "./i18n.js";
import { presentJob, startJob, systemInfo, type Channel } from "./system.js";
import { refreshTools, type Tools } from "./tools.js";
import { HttpError, VIDEO_ID } from "./types.js";
import { downloadHd, pruneCache, resolveStreams } from "./ytdlp.js";

function videoId(params: unknown): string {
  const id = (params as { id?: string }).id ?? "";
  if (!VIDEO_ID.test(id)) throw new HttpError(400, msg("invalidVideoId"));
  return id;
}

function query(q: unknown): string {
  const s = typeof q === "string" ? q.trim() : "";
  if (!s) throw new HttpError(400, msg("emptyQuery"));
  return s.slice(0, 200);
}

export interface StartOptions {
  port?: number;
  host?: string;
  /** Try the next ports when the preferred one is taken (the desktop app does this). */
  portFallback?: boolean;
}

export interface RunningServer {
  port: number;
  tools: Tools;
  close: () => Promise<void>;
}

/** Builds the Earful HTTP server (API + web app) and starts listening. */
export async function startServer(opts: StartOptions = {}): Promise<RunningServer> {
  library.useLibraryStorage(fileStorage());
  usePlaysStorage(playsFileStorage());
  const found = await refreshTools();
  const app = Fastify({ logger: { level: process.env.LOG_LEVEL ?? "warn" } });
  // The music server can still start if settings.json is temporarily unreadable.
  let discordEnabled = true;
  try {
    discordEnabled = getSettings().discord;
  } catch {
    // Keep the default in memory until settings can be read again.
  }
  const discord = createDiscordPresence(discordEnabled);
  app.addHook("onClose", () => discord.close());

  app.setErrorHandler((err, req, reply) => {
    const e = err as Error & { statusCode?: number };
    const status = e instanceof HttpError ? e.status : e.statusCode ?? 500;
    if (status >= 500) app.log.error(e);
    // Earful's own errors are translated into the language the app asked for.
    const error = e instanceof HttpError ? tr(langOf(req), e.text) : e.message;
    if (!reply.sent) reply.code(status).send({ error, code: e instanceof HttpError ? e.code : undefined });
  });

  app.get("/api/health", async () => ({ ok: true }));

  // System: yt-dlp status and one-click update

  app.get("/api/system", (req) => systemInfo(langOf(req)));

  app.post("/api/system/ytdlp", async (req) => {
    const { channel } = (req.body ?? {}) as { channel?: string };
    return presentJob(startJob((channel === "nightly" ? "nightly" : "stable") satisfies Channel), langOf(req));
  });

  // Discovery

  app.get("/api/search", async (req) => {
    const { q, type } = req.query as { q?: string; type?: string };
    return { tracks: await search(query(q), type === "video" ? "video" : "song", langOf(req)) };
  });

  app.get("/api/suggest", async (req) => {
    const { q } = req.query as { q?: string };
    if (!q?.trim()) return { suggestions: [] };
    return { suggestions: await suggestions(q.trim().slice(0, 100), langOf(req)).catch(() => []) };
  });

  app.get("/api/radio/:id", async (req) => ({ tracks: await radio(videoId(req.params)) }));

  // Browse by genre: genre → its artists or all its songs → an artist's top songs

  app.get("/api/genres", async (req) => ({ genres: await genres(langOf(req)) }));

  app.get("/api/genres/:gid", async (req) => {
    const { gid } = req.params as { gid: string };
    if (!GENRE_ID.test(gid)) throw new HttpError(400, msg("invalidGenre"));
    return genre(gid, langOf(req));
  });

  /** "Load more" for a genre's artists: `offset` is how many the app already shows. */
  app.get("/api/genres/:gid/artists", async (req) => {
    const { gid } = req.params as { gid: string };
    const offset = Number((req.query as { offset?: string }).offset ?? 0);
    if (!GENRE_ID.test(gid)) throw new HttpError(400, msg("invalidGenre"));
    if (!Number.isInteger(offset) || offset < 0 || offset > 1000) throw new HttpError(400, msg("invalidOffset"));
    return genreArtists(gid, offset, langOf(req));
  });

  app.get("/api/artist-id", async (req) => {
    const { name } = req.query as { name?: string };
    return { id: await artistId(query(name), langOf(req)) };
  });

  app.get("/api/lyrics/:id", async (req) => {
    const { title, artist, album, duration } = req.query as Record<string, unknown>;
    const field = (value: unknown) => typeof value === "string" ? value.trim().slice(0, 300) : "";
    const lyrics = await lyricsFor({
      id: videoId(req.params),
      title: field(title),
      artist: field(artist),
      album: field(album),
      duration: Number(field(duration)) || 0,
    }, langOf(req));
    if (!lyrics) throw new HttpError(404, msg("noLyrics"));
    return lyrics;
  });

  app.get("/api/artists/:aid", async (req) => {
    const { aid } = req.params as { aid: string };
    if (!ARTIST_ID.test(aid)) throw new HttpError(400, msg("invalidArtist"));
    return artist(aid, langOf(req));
  });

  app.get("/api/artists/:aid/songs", async (req) => {
    const { aid } = req.params as { aid: string };
    if (!ARTIST_ID.test(aid)) throw new HttpError(400, msg("invalidArtist"));
    const offset = Number((req.query as { offset?: string }).offset ?? 0);
    return artistSongs(aid, Number.isFinite(offset) ? offset : 0, langOf(req));
  });

  app.get("/api/albums/:alid", async (req) => {
    const { alid } = req.params as { alid: string };
    if (!ALBUM_ID.test(alid)) throw new HttpError(400, msg("invalidAlbum"));
    return album(alid, langOf(req));
  });

  app.get("/api/search/albums", async (req) => {
    const { q } = req.query as { q?: string };
    return { albums: await searchAlbums(query(q), langOf(req)) };
  });

  /** The music video for a song, so "Vídeo" mode can show the clip instead of a still cover. */
  app.get("/api/video-for/:id", async (req) => {
    const { title, artist, duration } = req.query as { title?: string; artist?: string; duration?: string };
    if (!title?.trim()) throw new HttpError(400, msg("missingTitle"));
    const track = await findVideoFor(videoId(req.params), title.slice(0, 200), (artist ?? "").slice(0, 200), Number(duration) || 0);
    return { track };
  });

  // Playback

  app.get("/api/discord", () => discord.status());

  app.put("/api/discord", async (req) => {
    const { enabled } = (req.body ?? {}) as { enabled?: unknown };
    if (typeof enabled !== "boolean") throw new HttpError(400, msg("discordSetting"));
    try {
      updateSettings({ discord: enabled });
    } catch {
      throw new HttpError(500, msg("discordSettingsFailed"));
    }
    return discord.setEnabled(enabled);
  });

  app.post("/api/now-playing", async (req, reply) => {
    if (req.body === null) {
      discord.setNowPlaying(null);
    } else {
      const body = (req.body ?? {}) as { track?: unknown; playing?: unknown; position?: unknown; duration?: unknown };
      const seconds = (value: unknown) => typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.min(value, 1e9)) : 0;
      const duration = seconds(body.duration);
      const position = Math.min(seconds(body.position), duration || Infinity);
      discord.setNowPlaying({ track: library.sanitizeTrack(body.track), playing: body.playing === true, position, duration }, langOf(req));
    }
    return reply.code(204).send();
  });

  /** Resolves stream URLs ahead of time so the next track starts instantly. */
  app.post("/api/prepare/:id", async (req) => {
    const id = videoId(req.params);
    if ((req.query as { audio?: string }).audio === "1") {
      const local = downloadedAudio(id) ?? cachedAudio(id);
      if (local) return { id, title: local.track.title, duration: local.track.duration, hasSdVideo: false };
    }
    const r = await resolveStreams(id);
    return { id: r.id, title: r.title, duration: r.duration, hasSdVideo: !!r.video };
  });

  app.get("/api/stream/:id/audio", async (req, reply) => {
    const id = videoId(req.params);
    const played = (req.query as { ahead?: string }).ahead !== "1";
    try {
      const download = downloadedAudio(id);
      const local = download ?? cachedAudio(id, played);
      if (local) {
        reply.header("x-earful-source", download ? "download" : "cache");
        return await serveFile(req, reply, local.file, local.mime);
      }
      if (played && !isDownloading(id)) void cacheAudio(id, true).catch((error) => req.log.debug(error));
    } catch (error) {
      req.log.debug(error);
      if (reply.sent) return reply;
    }
    if (!played) return reply.code(404).send();
    reply.header("x-earful-source", "stream");
    return proxyStream(req, reply, id, "audio");
  });

  app.get("/api/stream/:id/video", async (req, reply) => {
    const id = videoId(req.params);
    const { q } = req.query as { q?: string };
    if (q === "hd") return serveFile(req, reply, await downloadHd(id), "video/mp4");
    const resolved = await resolveStreams(id);
    if (!resolved.video) return serveFile(req, reply, await downloadHd(id), "video/mp4");
    return proxyStream(req, reply, id, "video");
  });

  app.get("/api/cache", () => cacheStats());
  app.put("/api/cache", (req) => {
    const { days } = (req.body ?? {}) as { days?: unknown };
    if (!isCacheDays(days)) throw new HttpError(400, msg("invalidCacheDays"));
    updateSettings({ cacheDays: days });
    pruneAudioCache();
    return cacheStats();
  });
  app.delete("/api/cache", () => clearAudioCache());
  app.post("/api/cache/:id", async (req, reply) => {
    const id = videoId(req.params);
    const track = req.body == null ? undefined : library.sanitizeTrack(req.body);
    if (track && track.id !== id) throw new HttpError(400, msg("idMismatch"));
    if (!downloadedAudio(id) && !isDownloading(id)) {
      const { ahead: prefetch, wait } = req.query as { ahead?: string; wait?: string };
      const ahead = prefetch === "1";
      const job = cacheAudio(id, !ahead, track);
      if (ahead || wait === "1") await job;
      else void job.catch((error) => req.log.debug(error));
    }
    return reply.code(204).send();
  });

  app.get("/api/downloads", () => downloadStatus());
  app.post("/api/downloads", (req) => {
    const { tracks } = (req.body ?? {}) as { tracks?: unknown };
    if (!Array.isArray(tracks)) throw new HttpError(400, msg("tracksRequired"));
    return enqueueDownloads(tracks.map(library.sanitizeTrack));
  });
  app.delete("/api/downloads/:id", async (req, reply) => {
    await removeDownload(videoId(req.params));
    return reply.code(204).send();
  });
  app.get("/api/offline", () => {
    const downloads = listDownloaded();
    const ids = new Set(downloads.map(({ track }) => track.id));
    return { tracks: [
      ...downloads.map(({ track }) => ({ ...track, offline: "downloaded" })),
      ...listCached().filter(({ track }) => !ids.has(track.id)).map(({ track }) => ({ ...track, offline: "cached" })),
    ] };
  });

  app.post("/api/plays", { bodyLimit: 16_384 }, async (req, reply) => {
    let event = req.body;
    if (typeof event === "string") {
      try {
        event = JSON.parse(event);
      } catch {
        throw new HttpError(400, msg("invalidPlay"));
      }
    }
    await recordPlay(event);
    return reply.code(204).send();
  });

  // Every play, for backups.
  app.get("/api/plays", async () => ({ plays: await allPlays() }));

  app.delete("/api/plays", async (_req, reply) => {
    await clearPlays();
    return reply.code(204).send();
  });

  app.get("/api/stats", async (req, reply) => {
    const { from, to, tz, top } = req.query as Record<string, unknown>;
    const parse = (value: unknown, limit: number) => {
      if (value === undefined) return null;
      if (typeof value === "string" && /^-?\d+$/.test(value) && Math.abs(Number(value)) <= limit) return Number(value);
      throw new HttpError(400, msg("invalidStatsRange"));
    };
    const tops = parse(top, MAX_TOP);
    const range = { from: parse(from, 8.64e15), to: parse(to, 8.64e15), tzOffsetMin: parse(tz, 14 * 60) ?? 0, top: tops !== null && tops > 0 ? tops : undefined };
    if (range.from !== null && range.to !== null && range.from > range.to) throw new HttpError(400, msg("invalidStatsRange"));
    reply.header("cache-control", "no-store");
    return computeStats(await allPlays(), range);
  });

  app.get("/api/image", async (req, reply) => {
    const url = coverUrl((req.query as { u?: unknown }).u);
    if (!url) throw new HttpError(400, msg("invalidCover"));
    const unavailable = () => new HttpError(502, msg("coverUnavailable"));
    // Do not follow redirects, which could take an allowed URL outside the cover hosts.
    const response = await fetch(url, { redirect: "error", signal: AbortSignal.timeout(8_000) }).catch(() => {
      throw unavailable();
    });
    const type = response.headers.get("content-type") ?? "";
    if (!response.ok || !response.body || !isCoverType(type) ||
      Number(response.headers.get("content-length")) > MAX_COVER_BYTES) {
      await response.body?.cancel().catch(() => {});
      throw unavailable();
    }
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > MAX_COVER_BYTES) throw unavailable();
        chunks.push(value);
      }
    } catch {
      await reader.cancel().catch(() => {});
      throw unavailable();
    } finally {
      reader.releaseLock();
    }
    return reply.type(type).header("x-content-type-options", "nosniff")
      .header("cache-control", "public, max-age=86400").send(Buffer.concat(chunks, size));
  });

  // Library

  app.get("/api/library", () => library.getLibrary());

  /** Restores a backup file exported by any Earful instance. Big libraries need more than the 1 MB default body. */
  app.post("/api/library/import", { bodyLimit: 25 * 1024 * 1024 }, async (req) => {
    const body = (req.body ?? {}) as { backup?: { format?: unknown; version?: unknown; library?: unknown; plays?: unknown }; mode?: unknown };
    const backup = body.backup;
    if (backup?.format !== "earful-backup") throw new HttpError(400, msg("notBackup"));
    if (typeof backup.version !== "number" || backup.version > 1) {
      throw new HttpError(400, msg("newerBackup"));
    }
    const result = await library.importLibrary(backup.library, body.mode === "replace" ? "replace" : "merge");
    // Listening stats are always merged, never replaced: a backup only adds the plays this Earful lacks.
    return { ...result, playsAdded: await mergePlays(backup.plays) };
  });

  // Phone sync settings (syncServer.ts): only for this computer itself. On a server shared on the network, someone
  // else must not be able to read the pairing code or turn sync on.
  const local = (ip: string) => ip === "127.0.0.1" || ip === "::1" || ip === "::ffff:127.0.0.1";
  const onlyLocal = (req: { ip: string }) => {
    if (!local(req.ip)) throw new HttpError(403, msg("syncLocalOnly"));
  };
  app.get("/api/sync", (req) => (onlyLocal(req), syncStatus()));
  app.put("/api/sync", async (req) => {
    onlyLocal(req);
    return setSyncEnabled((req.body as { enabled?: unknown } | null)?.enabled === true);
  });
  app.post("/api/sync/code", (req) => (onlyLocal(req), newSyncCode()));

  app.put("/api/favorites/:id", async (req) => {
    const track = library.sanitizeTrack(req.body);
    if (track.id !== videoId(req.params)) throw new HttpError(400, msg("idMismatch"));
    return { favorites: await library.addFavorite(track) };
  });

  /** Bulk add, e.g. from the list search. */
  app.post("/api/favorites", async (req) => {
    const { tracks } = (req.body ?? {}) as { tracks?: unknown };
    if (!Array.isArray(tracks)) throw new HttpError(400, msg("tracksRequired"));
    return { favorites: await library.addFavorites(tracks.slice(0, 500).map(library.sanitizeTrack)) };
  });

  app.delete("/api/favorites/:id", async (req) => ({ favorites: await library.removeFavorite(videoId(req.params)) }));

  app.post("/api/history", async (req) => ({ history: await library.pushHistory(library.sanitizeTrack(req.body)) }));

  app.post("/api/playlists", { bodyLimit: 5 * 1024 * 1024 }, async (req) => {
    const body = (req.body ?? {}) as { name?: unknown; tracks?: unknown; id?: unknown };
    const tracks = Array.isArray(body.tracks) ? body.tracks.slice(0, 5000).map(library.sanitizeTrack) : [];
    const id = typeof body.id === "string" ? body.id : undefined;
    return library.createPlaylist(typeof body.name === "string" ? body.name : "", tracks, id);
  });

  app.patch("/api/playlists/:pid", async (req) => {
    const { pid } = req.params as { pid: string };
    const { name } = (req.body ?? {}) as { name?: unknown };
    return library.renamePlaylist(pid, typeof name === "string" ? name : "");
  });

  app.delete("/api/playlists/:pid", async (req, reply) => {
    await library.deletePlaylist((req.params as { pid: string }).pid);
    return reply.code(204).send();
  });

  /** One track, or `{ tracks: [...] }` to add many at once. */
  app.post("/api/playlists/:pid/tracks", async (req) => {
    const body = (req.body ?? {}) as { tracks?: unknown };
    const tracks = Array.isArray(body.tracks) ? body.tracks.slice(0, 500).map(library.sanitizeTrack) : library.sanitizeTrack(req.body);
    return library.addToPlaylist((req.params as { pid: string }).pid, tracks);
  });

  app.delete("/api/playlists/:pid/tracks/:id", async (req) =>
    library.removeFromPlaylist((req.params as { pid: string }).pid, videoId(req.params)),
  );

  // Web app (production build)

  if (existsSync(config.webDist)) {
    // Wildcard mode resolves files per request, so rebuilding the web app never needs a server restart.
    await app.register(fastifyStatic, { root: config.webDist });
    app.setNotFoundHandler((req, reply) => {
      if (req.method === "GET" && !req.url.startsWith("/api/")) return reply.sendFile("index.html");
      reply.code(404).send({ error: tr(langOf(req), msg("routeNotFound")) });
    });
  }

  const host = opts.host ?? config.host;
  const preferred = opts.port ?? config.port;
  const port = opts.portFallback ? await freePort(preferred, host) : preferred;
  const prune = () => {
    try {
      pruneAudioCache();
    } catch (error) {
      app.log.warn(error);
    }
  };
  let audioPruner: ReturnType<typeof setInterval> | undefined;
  app.addHook("onClose", () => {
    clearInterval(audioPruner);
    flushAudioCache();
  });
  await app.listen({ port, host });
  await startSyncIfEnabled();
  prune();
  audioPruner = setInterval(prune, 3600_000).unref();

  pruneCache().catch(() => {});
  return { port, tools: found, close: () => app.close() };
}

/** First free port from `start` (up to 10 tries), so a second copy or a dev server doesn't block launch. */
async function freePort(start: number, host: string): Promise<number> {
  for (let port = start; port < start + 10; port++) {
    const free = await new Promise<boolean>((resolve) => {
      const probe = createServer()
        .once("error", () => resolve(false))
        .once("listening", () => probe.close(() => resolve(true)))
        .listen(port, host);
    });
    if (free) return port;
  }
  throw new HttpError(500, msg("noFreePort", { from: start, to: start + 9 }));
}
