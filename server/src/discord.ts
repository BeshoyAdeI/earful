import { Client } from "@xhayper/discord-rpc";
import { msg, tr, type Lang } from "./i18n.js";
import type { Track } from "./types.js";

// Create an application named "Earful" at https://discord.com/developers/applications.
// Discord displays that name. Upload the Earful logo as a Rich Presence art asset named "earful".
const DISCORD_CLIENT_ID = "";
const RETRY_MS = 30_000;
const UPDATE_MS = 2_000;
const RATE_WINDOW_MS = 20_000;
const PAUSE_MS = 5 * 60_000;

export interface NowPlaying {
  track: Track;
  playing: boolean;
  position: number;
  duration: number;
}

export function createDiscordPresence(enabled: boolean) {
  const clientId = process.env.EARFUL_DISCORD_DISABLED === "1"
    ? ""
    : process.env.EARFUL_DISCORD_CLIENT_ID?.trim() || DISCORD_CLIENT_ID;
  let client: Client | undefined;
  let retry: NodeJS.Timeout | undefined;
  let update: NodeJS.Timeout | undefined;
  let pause: NodeJS.Timeout | undefined;
  let wanted = false;
  let sent = false;
  let sending = false;
  let dirty = false;
  const updates: number[] = [];
  let current: { playback: NowPlaying; at: number; lang: Lang } | null = null;

  function reconnect() {
    if (!clientId || !enabled || !wanted || client || retry) return;
    retry = setTimeout(() => {
      retry = undefined;
      connect();
    }, RETRY_MS).unref();
  }

  async function connect() {
    if (!clientId || !enabled || !wanted || client || retry) return;
    let next: Client | undefined;
    try {
      next = new Client({ clientId });
      client = next;
      next.on("disconnected", () => {
        if (client !== next) return;
        client = undefined;
        sent = false;
        reconnect();
      });
      await next.login();
      if (client === next) {
        dirty = true;
        scheduleUpdate();
      } else {
        await next.destroy();
      }
    } catch {
      if (client === next) client = undefined;
      await next?.destroy().catch(() => {});
      reconnect();
    }
  }

  function scheduleUpdate() {
    if (!enabled || !client?.isConnected || !dirty || sending || update) return;
    const now = Date.now();
    while (updates.length && updates[0]! <= now - RATE_WINDOW_MS) updates.shift();
    const nextUpdate = (updates.at(-1) ?? -Infinity) + UPDATE_MS;
    const nextWindowSlot = updates.length >= 5 ? updates[0]! + RATE_WINDOW_MS : now;
    update = setTimeout(() => {
      update = undefined;
      void sendUpdate();
    }, Math.max(nextUpdate, nextWindowSlot, now) - now).unref();
  }

  async function sendUpdate() {
    const connection = client;
    const user = connection?.user;
    if (!enabled || !connection?.isConnected || !user) return;
    dirty = false;
    if (!current && !sent) return;
    sending = true;
    updates.push(Date.now());
    try {
      if (!current) {
        await user.clearActivity();
        if (client === connection) sent = false;
        return;
      }
      const { playback: { track, playing, position, duration }, at, lang } = current;
      const paused = tr(lang, msg("discordPaused"));
      const start = at - position * 1000;
      const end = start + duration * 1000;
      sent = true;
      await user.setActivity({
        type: 2,
        statusDisplayType: 0,
        details: track.title.slice(0, 128),
        state: playing ? track.artist.slice(0, 128) : [track.artist.slice(0, 110), paused].filter(Boolean).join(" · "),
        largeImageKey: track.art.startsWith("https://") && URL.canParse(track.art) ? track.art : "earful",
        largeImageText: (track.album || track.title).slice(0, 128),
        smallImageKey: "earful",
        ...(playing ? { startTimestamp: start, endTimestamp: duration > 0 ? end : undefined } : {}),
        buttons: [{ label: tr(lang, msg("discordYoutube")), url: `https://music.youtube.com/watch?v=${track.id}` }],
      });
    } catch {
      // Discord may close or reject an activity between updates.
    } finally {
      sending = false;
      scheduleUpdate();
    }
  }

  function setNowPlaying(playback: NowPlaying | null, lang: Lang = "en") {
    if (!clientId) return;
    current = playback ? { playback, at: Date.now(), lang } : null;
    clearTimeout(pause);
    if (playback && !playback.playing) pause = setTimeout(() => setNowPlaying(null), PAUSE_MS).unref();
    dirty = true;
    if (playback) wanted = true;
    void connect();
    scheduleUpdate();
  }

  async function disconnect() {
    clearTimeout(retry);
    retry = undefined;
    clearTimeout(update);
    update = undefined;
    const previous = client;
    client = undefined;
    sent = false;
    await previous?.destroy().catch(() => {});
  }

  function status() {
    return { available: !!clientId, enabled, connected: !!client?.isConnected };
  }

  return {
    setNowPlaying,
    status() {
      wanted = true;
      void connect();
      return status();
    },
    async setEnabled(value: boolean) {
      enabled = value;
      if (value) {
        wanted = true;
        void connect();
        scheduleUpdate();
      } else {
        await disconnect();
      }
      return status();
    },
    async close() {
      wanted = false;
      clearTimeout(pause);
      await disconnect();
    },
  };
}
