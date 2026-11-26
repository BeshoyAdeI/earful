import { Capacitor } from "@capacitor/core";
import {
  DEFAULT_CLIENTS,
  directAudio,
  directVideo,
  fetchRemoteClients,
  validClients,
  VIDEO_CLIENTS,
  type DirectAudio,
} from "../../../server/src/directAudio";
import { msg, tr } from "../../../server/src/i18n";
import { getLang } from "../i18n";
import { ApiError } from "../lib/apiTypes";
import { config } from "./shims/config";
import { nativeResolverAvailable, resolveNatively } from "./ytplayer";

/**
 * Resolves a track's stream on the phone, the job yt-dlp does on the server. On iOS the app's native side asks first
 * (ios/App/App/EarfulYouTube.swift); otherwise, and as iOS's fallback, the audio comes straight from YouTube's API
 * (server/src/directAudio.ts). Each platform's list of clients can be updated remotely (mobile/streaming.json); the
 * last one received is kept.
 */

const ios = Capacitor.getPlatform() === "ios";
// On iOS VISIONOS is bot-checked from the web view while the IOS client still answers; Android uses the client
// yt-dlp itself relies on.
const PLATFORM_CLIENTS = ios ? ["IOS", "VISIONOS"] : DEFAULT_CLIENTS;
const REMOTE_KEY = ios ? "ios" : "clients";
const CLIENTS_KEY = ios ? "earful:stream-clients-ios" : "earful:stream-clients";

type Kind = "audio" | "video";
const cache = { audio: new Map<string, DirectAudio>(), video: new Map<string, DirectAudio>() };
const inflight = { audio: new Map<string, Promise<DirectAudio>>(), video: new Map<string, Promise<DirectAudio>>() };

function storedClients(): string[] {
  try {
    return validClients(JSON.parse(localStorage.getItem(CLIENTS_KEY) ?? "null")) ?? PLATFORM_CLIENTS;
  } catch {
    return PLATFORM_CLIENTS;
  }
}

let clients = storedClients();

// Pick up a newer client list in the background; the stored one (or the default) is used meanwhile.
void fetchRemoteClients(REMOTE_KEY).then((remote) => {
  if (!remote) return;
  clients = remote;
  try {
    localStorage.setItem(CLIENTS_KEY, JSON.stringify(remote));
  } catch {
    /* storage unavailable: keep it for this session */
  }
});

/** iOS: the native resolver, or null to fall back to the in-app clients. */
async function resolveOnIos(id: string): Promise<DirectAudio | null> {
  if (!nativeResolverAvailable()) return null;
  try {
    const r = await resolveNatively(id, getLang() === "pt-BR" ? "pt-BR" : "en", config.location);
    if (r.error || !r.url) return null;
    const expire = Number(new URL(r.url).searchParams.get("expire")) * 1000;
    return {
      url: r.url,
      mime: r.mime || "audio/mp4",
      title: r.title,
      duration: r.duration,
      expiresAt: expire || Date.now() + 3 * 3600_000,
    };
  } catch {
    return null;
  }
}

async function resolve(id: string, kind: Kind): Promise<DirectAudio> {
  try {
    const lang = getLang();
    const resolved = kind === "video"
      ? await directVideo(id, [...new Set([...clients, ...VIDEO_CLIENTS])], lang)
      : (await resolveOnIos(id)) ?? await directAudio(id, clients, lang);
    cache[kind].set(id, resolved);
    return resolved;
  } catch (e) {
    throw new ApiError(404, (e as Error).message || tr(getLang(), msg(kind === "video" ? "noVideo" : "noAudio")));
  }
}

/** A track's stream, from cache while its URL is still good for a minute or more. */
function resolveStream(id: string, kind: Kind): Promise<DirectAudio> {
  const hit = cache[kind].get(id);
  if (hit && hit.expiresAt - Date.now() > 60_000) return Promise.resolve(hit);
  const jobs = inflight[kind];
  let job = jobs.get(id);
  if (!job) {
    job = resolve(id, kind).finally(() => jobs.delete(id));
    jobs.set(id, job);
  }
  return job;
}

export const resolveAudio = (id: string) => resolveStream(id, "audio");
export const resolveVideo = (id: string) => resolveStream(id, "video");

/** Forgets the stream behind a URL that stopped working, so the next try resolves a fresh one. */
export function forgetUrl(url: string) {
  for (const streams of Object.values(cache)) {
    for (const [id, stream] of streams) if (stream.url === url) streams.delete(id);
  }
}
