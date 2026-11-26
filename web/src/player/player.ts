import { create } from "zustand";
import { getT, useT } from "../i18n";
import { api, capabilities, explainStreamError, streamSource, systemMedia, type ApiError, type ErrorCode, type PlayEvent } from "../lib/api";
import { createAudio } from "../lib/audio";
import { shuffled } from "../lib/format";
import type { Track } from "../lib/types";
import { useLibrary } from "../stores/library";
import { useDownloads } from "../stores/downloads";
import { openSettings } from "../stores/system";
import { toast } from "../stores/ui";
import { goTo } from "../lib/navigation";
import { paths } from "../lib/routes";

export type Repeat = "off" | "all" | "one";
/** A code translated where it is shown (so switching languages updates it), or a server error already in the right language. */
export type StatusNote = "findingClip" | "preparingHd" | "loadingVideo" | "fetchingRadio" | { error: string };
export type Status = "idle" | "loading" | "playing" | "paused" | "error";
type Kind = "audio" | "video";
type Quality = "sd" | "hd";

interface PlayerState {
  queue: Track[];
  /** Queue order before shuffle was turned on, restored when it is turned off. */
  original: Track[] | null;
  index: number;
  status: Status;
  /** What playback is busy with (or why it failed), shown instead of the artist. See `useStatusText`. */
  statusText: StatusNote | null;
  /** Which media element is driving playback right now. */
  mediaKind: Kind;
  /** Set when Video mode is on but the current song has no music video on YouTube. */
  videoNote: "noClip" | null;
  /** Intrinsic width/height of the current video, so vertical videos get a vertical stage. */
  videoAspect: number;
  position: number;
  duration: number;
  buffered: number;
  volume: number;
  muted: boolean;
  shuffle: boolean;
  repeat: Repeat;
  preferVideo: boolean;
  quality: Quality;
  autoRadio: boolean;

  playList: (tracks: Track[], start?: number) => void;
  playTrack: (track: Track) => void;
  playNext: (track: Track) => void;
  addToQueue: (track: Track) => void;
  /** Adds several tracks to the end of the queue (the selection bar), with one notice. */
  addManyToQueue: (tracks: Track[]) => void;
  removeAt: (i: number) => void;
  /** Moves the track at `from` to position `to` in the queue; the playing track keeps playing. */
  moveTo: (from: number, to: number) => void;
  jumpTo: (i: number) => void;
  clearUpcoming: () => void;
  startRadio: (track: Track) => Promise<void>;
  toggle: () => void;
  next: () => void;
  prev: () => void;
  seek: (seconds: number) => void;
  setVolume: (v: number) => void;
  toggleMute: () => void;
  toggleShuffle: () => void;
  cycleRepeat: () => void;
  setPreferVideo: (on: boolean) => void;
  setQuality: (q: Quality) => void;
  setAutoRadio: (on: boolean) => void;
}

// Media elements live outside React so playback survives any re-render or route change.
// On iOS this is the native player behind the same API (see lib/audio.ts).
const audio = createAudio();

export const videoEl = document.createElement("video");
videoEl.playsInline = true;
videoEl.preload = "auto";
videoEl.setAttribute("playsinline", "");
videoEl.className = "block h-full w-full object-contain bg-black";

const mediaFor = (k: Kind): HTMLMediaElement => (k === "video" ? videoEl : audio);

let loaded: { id: string; kind: Kind; quality: Quality } | null = null;
let pendingSeek = 0;
let token = 0;
let recordedToken = -1;

const STORAGE_KEY = "earful:player";
let listening: PlayEvent | undefined;
let lastListenTime: number | undefined;
let listenTrack: Track | undefined;

/** Start the next listening event at the point where history is cleared. */
export function discardCurrentListen() {
  listening = undefined;
  lastListenTime = undefined;
}

/**
 * `continuing`: the page is being hidden (minimized, phone locked) and the music may well keep playing. The listen
 * so far is saved in case the app is closed, but it keeps counting: the next report for the same song carries the
 * same start time, and the server keeps one event per song and start time, so a minimize doesn't make two plays.
 */
function flushListen({ closing = false, continuing = false } = {}) {
  const event = listening;
  if (continuing && (!event || event.sec < 10)) return;
  if (!continuing) {
    listening = undefined;
    listenTrack = undefined;
    lastListenTime = undefined;
  }
  if (!event || event.sec < 10) return;
  const copy = { ...event };
  if (closing && api.recordPlayBeacon?.(copy)) return;
  void api.recordPlay(copy).then(() => window.dispatchEvent(new Event("earful:play-recorded"))).catch(() => {});
}

function startListening(track: Track, media: HTMLMediaElement) {
  if (listenTrack?.id !== track.id) {
    listenTrack = track;
    listening = undefined;
  }
  listening ??= newListen(track);
  if (lastListenTime === undefined) lastListenTime = media.currentTime;
}

function newListen({ id, title, artist, artists, album, thumb, duration }: Track): PlayEvent {
  return { id, title, artist, artists, album, thumb, duration, at: Date.now(), sec: 0 };
}

function countListening(media: HTMLMediaElement, playing: boolean) {
  const current = media.currentTime;
  const delta = current - (lastListenTime ?? current);
  lastListenTime = current;
  if (!listenTrack || !playing || media.paused || media.seeking || !(delta > 0 && delta < 2.5)) return;
  listening ??= newListen(listenTrack);
  listening.sec += delta;
}

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") flushListen({ closing: true, continuing: true });
});
window.addEventListener("pagehide", () => flushListen({ closing: true, continuing: true }));

interface Saved {
  queue: Track[];
  original: Track[] | null;
  index: number;
  position: number;
  volume: number;
  muted: boolean;
  shuffle: boolean;
  repeat: Repeat;
  preferVideo: boolean;
  quality: Quality;
  autoRadio: boolean;
}

function readSaved(): Partial<Saved> {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}") as Partial<Saved>;
  } catch {
    return {};
  }
}

const saved = readSaved();

/**
 * Songs from YouTube Music are "art tracks": audio with a still cover. In Video mode we play the
 * song's music video instead. Song id → video id, or null when YouTube has no clip for it.
 */
const clipFor = new Map<string, string | null>();
const clipLookups = new Map<string, Promise<string | null>>();

function lookupClip(track: Track): Promise<string | null> {
  if (track.kind === "video") return Promise.resolve(track.id);
  if (clipFor.has(track.id)) return Promise.resolve(clipFor.get(track.id)!);
  let lookup = clipLookups.get(track.id);
  if (!lookup) {
    lookup = api
      .videoFor(track)
      .then(
        (v) => {
          const id = v?.id ?? null;
          clipFor.set(track.id, id);
          return id;
        },
        () => null, // network hiccup: don't remember it, try again next time
      )
      .finally(() => clipLookups.delete(track.id));
    clipLookups.set(track.id, lookup);
  }
  return lookup;
}

const needsClipLookup = (track: Track, preferVideo: boolean) =>
  preferVideo && !track.offline && track.kind === "song" && !clipFor.has(track.id);

const nextIndex = (s: PlayerState) => s.index < s.queue.length - 1 ? s.index + 1 : s.repeat === "all" && s.queue.length ? 0 : -1;
const upcomingTrack = (s: PlayerState) => s.repeat === "one" ? undefined : s.queue[nextIndex(s)];

export const usePlayer = create<PlayerState>((set, get) => {
  const kindFor = (track: Track): Kind =>
    capabilities.video && get().preferVideo && !track.offline && (track.kind === "video" || !!clipFor.get(track.id)) ? "video" : "audio";
  /** The YouTube id to stream: the song itself, or its music video in Video mode. */
  const mediaIdFor = (track: Track, kind: Kind) =>
    kind === "video" && track.kind !== "video" ? clipFor.get(track.id)! : track.id;
  const noteFor = (track: Track) =>
    get().preferVideo && !track.offline && track.kind === "song" && clipFor.get(track.id) === null ? ("noClip" as const) : null;
  const activeMedia = (): HTMLMediaElement | null => (loaded ? mediaFor(loaded.kind) : null);
  let warmedToken = -1;
  let warming: { id: string; done: Promise<void> } | undefined;
  let preload: HTMLAudioElement | undefined;

  function dropPreload() {
    warming = undefined;
    if (!preload) return;
    preload.removeAttribute("src");
    preload.load();
    preload = undefined;
  }

  function warmNext(media: HTMLMediaElement) {
    if (warmedToken === token || media !== audio || media.paused || get().preferVideo ||
      !Number.isFinite(media.duration) || media.duration <= 0 || media.currentTime < media.duration * 0.8) return;
    const next = upcomingTrack(get());
    if (!next || next.id === loaded?.id) return;
    warmedToken = token;
    const job = { id: next.id, done: api.cacheAhead(next) };
    warming = job;
    void job.done.then(async () => {
      void useDownloads.getState().loadOffline();
      if (warming !== job || upcomingTrack(get())?.id !== next.id || get().preferVideo) return;
      const source = await streamSource(next.id, "audio", get().quality, true);
      if (warming !== job || upcomingTrack(get())?.id !== next.id || get().preferVideo) return;
      preload = new Audio();
      preload.muted = true;
      preload.preload = "auto";
      preload.src = source;
    }).catch(() => {});
  }

  function play(media: HTMLMediaElement) {
    media.play().catch((err: DOMException) => {
      if (err.name === "AbortError") return; // src changed mid-start
      if (err.name === "NotAllowedError") set({ status: "paused" }); // autoplay blocked
    });
  }

  /**
   * `handoff`: switching Audio ⇄ Video on the same track. The playing element keeps going until the new one
   * actually plays, then the new one takes over at the same moment of the song, so there is no silent gap.
   */
  function load(index: number, opts: { autoplay?: boolean; startAt?: number; handoff?: boolean } = {}) {
    const s = get();
    const track = s.queue[index];
    if (!track) return;
    flushListen();
    // The next track's download may still be running (a skip at 85%): give it a moment to land so it plays from
    // disk, but never hold the start for the whole download — the stream works meanwhile.
    const ready = !s.preferVideo && warming?.id === track.id
      ? Promise.race([warming.done, new Promise<void>((r) => setTimeout(r, 1000))])
      : undefined;
    dropPreload();

    // Video mode on a song: find its music video first, then load whichever fits.
    if (needsClipLookup(track, s.preferVideo)) {
      const mine = ++token;
      set({
        index,
        status: "loading",
        statusText: "findingClip",
        videoNote: null,
        position: opts.startAt ?? 0,
        duration: track.duration,
        buffered: 0,
      });
      if (!opts.handoff) activeMedia()?.pause();
      if (!opts.handoff || !systemMedia) setMetadata(track);
      syncSystemMedia();
      void lookupClip(track).then(() => mine === token && load(index, opts));
      return;
    }

    const kind = kindFor(track);
    const media = mediaFor(kind);
    const other = mediaFor(kind === "video" ? "audio" : "video");
    const stop = (el: HTMLMediaElement) => {
      el.pause();
      if (el.getAttribute("src")) {
        el.removeAttribute("src");
        el.load();
      }
    };
    const outgoing = opts.handoff && !other.paused ? other : null;
    if (!outgoing) stop(other);

    token++;
    loaded = { id: track.id, kind, quality: s.quality };
    pendingSeek = opts.startAt ?? 0;
    const autoplay = opts.autoplay !== false;
    set({
      index,
      mediaKind: kind,
      status: autoplay ? "loading" : "paused",
      // Video may need a server-side download first (HD, or videos without a combined SD stream).
      statusText: kind === "video" ? (s.quality === "hd" ? "preparingHd" : "loadingVideo") : null,
      videoNote: noteFor(track),
      position: pendingSeek,
      duration: track.duration,
      buffered: 0,
    });
    media.volume = s.volume;
    media.muted = s.muted;
    const start = (src: string) => {
      media.src = src;
      if (autoplay) play(media);
    };
    let cancelHandoff: (() => void) | undefined;
    if (outgoing) {
      const mine = token;
      const takeOver = () => {
        media.removeEventListener("playing", takeOver);
        media.removeEventListener("error", giveUp);
        if (mine !== token) return;
        // The old element kept playing meanwhile: continue from where it is now, not from the click.
        if (Math.abs(media.currentTime - outgoing.currentTime) > 0.4) media.currentTime = outgoing.currentTime;
        stop(outgoing);
      };
      const giveUp = () => {
        media.removeEventListener("playing", takeOver);
        media.removeEventListener("error", giveUp);
        if (mine === token) stop(outgoing);
      };
      cancelHandoff = giveUp;
      media.addEventListener("playing", takeOver);
      media.addEventListener("error", giveUp);
    }
    // The server's proxy URL is known right away; on Android the stream is first resolved on the phone.
    const getSource = () => streamSource(mediaIdFor(track, kind), kind, s.quality);
    const source = ready ? ready.catch(() => {}).then(getSource) : getSource();
    if (typeof source === "string") start(source);
    else {
      media.pause();
      media.removeAttribute("src");
      media.load();
      const mine = token;
      source.then(
        (src) => mine === token && start(src),
        (err: ApiError) => {
          if (mine !== token) return;
          cancelHandoff?.();
          report(err.message, err.code);
        },
      );
    }
    if (!opts.handoff || !systemMedia) setMetadata(track);
    syncSystemMedia();
  }

  async function continueWithRadio() {
    const s = get();
    const last = s.queue[s.index];
    if (!last) return;
    set({ status: "loading", statusText: "fetchingRadio" });
    try {
      const known = new Set(get().queue.map((t) => t.id));
      const more = (await api.radio(last.id)).filter((t) => !known.has(t.id)).slice(0, 25);
      if (!more.length) throw new Error("empty");
      set((st) => ({
        queue: [...st.queue, ...more],
        original: st.original ? [...st.original, ...more] : null,
      }));
      toast(getT().player.radioContinuing(last.title));
      load(get().index + 1);
    } catch {
      set({ status: "paused", statusText: null, position: 0 });
      scheduleNowPlaying(true);
    }
  }

  function onStarted() {
    const s = get();
    const track = s.queue[s.index];
    if (!track || recordedToken === token) return;
    recordedToken = token;
    useLibrary.getState().recordPlay(track);
    void api.cachePlayed(track).then(() => useDownloads.getState().loadOffline()).catch(() => {});
    // Warm up the next track (and, in Video mode, find and resolve its clip) so it starts quickly.
    const upcoming = s.preferVideo ? s.queue[s.index + 1] : upcomingTrack(s);
    if (!upcoming) return;
    if (s.preferVideo) void lookupClip(upcoming).then((id) => api.prepare(id ?? upcoming.id).catch(() => {}));
    else api.prepare(upcoming.id, undefined, true).catch(() => {});
  }

  function onEnded() {
    const track = listenTrack;
    flushListen();
    const s = get();
    if (s.repeat === "one") {
      const media = activeMedia();
      if (media) {
        media.currentTime = 0;
        if (track) listenTrack = track;
        play(media);
      }
      return;
    }
    const next = nextIndex(s);
    if (next >= 0) return load(next);
    if (s.autoRadio) return void continueWithRadio();
    set({ status: "paused", position: 0 });
    scheduleNowPlaying(true);
  }

  /** Shows why a track can't play, then moves on (unless every track would fail the same way). */
  function report(message: string, code?: ErrorCode) {
    const mine = token;
    flushListen();
    set({ status: "error", statusText: { error: message } });
    syncSystemMedia();
    const track = get().queue[get().index];
    // Tool problems hit every track: offer the fix instead of skipping through the whole queue.
    const toolProblem = code === "tool_missing" || code === "maybe_outdated";
    const t = getT();
    toast(
      t.player.cantPlay(track?.title ?? t.player.aTrack, message),
      "error",
      toolProblem ? { label: code === "tool_missing" ? t.common.install : t.common.update, run: () => openSettings("engine") } : undefined,
    );
    if (code !== "tool_missing" && get().index < get().queue.length - 1) {
      setTimeout(() => mine === token && get().next(), 2500);
    }
  }

  // A stream URL that expired mid-song gets one fresh try from the same spot before giving up.
  let retriedToken = -1;

  function onError(media: HTMLMediaElement) {
    const mine = token;
    const url = media.currentSrc || media.src;
    if (capabilities.retryOnError && retriedToken !== mine) {
      const at = media.currentTime || get().position;
      load(get().index, { startAt: at, autoplay: true });
      retriedToken = token;
      return;
    }
    set({ status: "error" });
    explainStreamError(url).then(({ message, code }) => {
      if (mine === token) report(message, code);
    });
  }

  function wire(media: HTMLMediaElement) {
    const isActive = () => activeMedia() === media;
    media.addEventListener("loadedmetadata", () => {
      if (!isActive()) return;
      if (pendingSeek > 0) {
        media.currentTime = pendingSeek;
        pendingSeek = 0;
      }
      if (Number.isFinite(media.duration)) set({ duration: media.duration });
      if (media === videoEl && videoEl.videoWidth && videoEl.videoHeight) {
        set({ videoAspect: videoEl.videoWidth / videoEl.videoHeight });
      }
      syncPositionState();
    });
    media.addEventListener("durationchange", () => {
      if (isActive() && Number.isFinite(media.duration)) set({ duration: media.duration });
    });
    media.addEventListener("playing", () => {
      if (!isActive()) return;
      const track = get().queue[get().index];
      if (track && loaded?.id === track.id) startListening(track, media);
      set({ status: "playing", statusText: null });
      onStarted();
      syncPlaybackState();
    });
    media.addEventListener("pause", () => {
      if (!isActive() || media.ended || get().status === "loading" || get().status === "error") return;
      lastListenTime = undefined;
      set({ status: "paused" });
      syncPlaybackState();
    });
    media.addEventListener("waiting", () => {
      if (isActive() && !media.paused) {
        lastListenTime = undefined;
        set({ status: "loading" });
      }
    });
    media.addEventListener("timeupdate", () => {
      if (!isActive() || pendingSeek > 0) return;
      countListening(media, get().status === "playing");
      if (Math.abs(media.currentTime - get().position) >= 0.2) set({ position: media.currentTime });
      warmNext(media);
      syncSystemMedia(); // throttled on the other side
    });
    media.addEventListener("progress", () => {
      if (!isActive() || !media.buffered.length) return;
      set({ buffered: media.buffered.end(media.buffered.length - 1) });
    });
    media.addEventListener("seeking", () => {
      if (isActive()) lastListenTime = undefined;
    });
    media.addEventListener("seeked", () => {
      if (!isActive()) return;
      lastListenTime = media.currentTime;
      syncPositionState();
      if (reportsPlayback) scheduleNowPlaying();
    });
    media.addEventListener("ended", () => isActive() && onEnded());
    media.addEventListener("error", () => isActive() && media.getAttribute("src") && onError(media));
  }
  wire(audio);
  wire(videoEl);

  const reloadIfKindChanged = () => {
    const s = get();
    const track = s.queue[s.index];
    if (!track) return;
    set({ videoNote: noteFor(track) });
    if (!loaded || loaded.id !== track.id) return;
    const wasPlaying = s.status === "playing" || s.status === "loading";
    if (needsClipLookup(track, s.preferVideo)) return load(s.index, { startAt: s.position, autoplay: wasPlaying, handoff: true });
    const kind = kindFor(track);
    if (loaded.kind === kind && (kind === "audio" || loaded.quality === s.quality)) return;
    load(s.index, { startAt: s.position, autoplay: wasPlaying, handoff: loaded.kind !== kind });
  };

  return {
    queue: saved.queue ?? [],
    original: saved.original ?? null,
    index: saved.index ?? 0,
    status: saved.queue?.length ? "paused" : "idle",
    statusText: null,
    mediaKind: "audio",
    videoNote: null,
    videoAspect: 16 / 9,
    position: saved.position ?? 0,
    duration: saved.queue?.[saved.index ?? 0]?.duration ?? 0,
    buffered: 0,
    volume: saved.volume ?? 0.9,
    muted: saved.muted ?? false,
    shuffle: saved.shuffle ?? false,
    repeat: saved.repeat ?? "off",
    preferVideo: capabilities.video && (saved.preferVideo ?? false),
    quality: capabilities.hdVideo ? (saved.quality ?? "sd") : "sd",
    autoRadio: saved.autoRadio ?? true,

    playList: (tracks, start = 0) => {
      if (!tracks.length) return;
      const first = tracks[start] ?? tracks[0];
      if (get().shuffle) {
        const rest = tracks.filter((_, i) => i !== start);
        set({ queue: [first, ...shuffled(rest)], original: tracks.slice() });
        load(0);
      } else {
        set({ queue: tracks.slice(), original: null });
        load(start);
      }
    },

    playTrack: (track) => {
      const s = get();
      const at = s.queue.findIndex((t) => t.id === track.id);
      if (at >= 0) {
        if (track.offline && !s.queue[at].offline) set({ queue: s.queue.map((entry, i) => i === at ? track : entry) });
        return load(at);
      }
      if (!s.queue.length) return get().playList([track]);
      const insert = s.index + 1;
      set({
        queue: [...s.queue.slice(0, insert), track, ...s.queue.slice(insert)],
        original: s.original ? [...s.original, track] : null,
      });
      load(insert);
    },

    playNext: (track) => {
      const s = get();
      if (!s.queue.length) return get().playList([track]);
      const insert = s.index + 1;
      set({
        queue: [...s.queue.slice(0, insert), track, ...s.queue.slice(insert)],
        original: s.original ? [...s.original, track] : null,
      });
      toast(getT().player.playsNext(track.title));
    },

    addToQueue: (track) => {
      const s = get();
      if (!s.queue.length) return get().playList([track]);
      set({ queue: [...s.queue, track], original: s.original ? [...s.original, track] : null });
      toast(getT().player.addedToQueue(track.title));
    },

    addManyToQueue: (tracks) => {
      if (tracks.length === 1) return get().addToQueue(tracks[0]);
      const s = get();
      if (!tracks.length) return;
      if (!s.queue.length) return get().playList(tracks);
      set({ queue: [...s.queue, ...tracks], original: s.original ? [...s.original, ...tracks] : null });
      toast(getT().player.addedManyToQueue(tracks.length));
    },

    removeAt: (i) => {
      const s = get();
      if (i < 0 || i >= s.queue.length) return;
      const removed = s.queue[i];
      const queue = s.queue.filter((_, j) => j !== i);
      const original = s.original?.filter((t) => t !== removed) ?? null;
      if (i < s.index) return set({ queue, original, index: s.index - 1 });
      if (i > s.index) return set({ queue, original });
      // Removing the current track: move on to whatever takes its place.
      set({ queue, original });
      if (queue[i]) load(i, { autoplay: s.status === "playing" });
      else {
        flushListen();
        token++;
        dropPreload();
        activeMedia()?.pause();
        loaded = null;
        set({ index: Math.max(0, queue.length - 1), status: queue.length ? "paused" : "idle", position: 0 });
      }
    },

    moveTo: (from, to) => {
      const s = get();
      const last = s.queue.length - 1;
      if (from < 0 || from > last || to < 0 || to > last || from === to) return;
      const queue = [...s.queue];
      const [moved] = queue.splice(from, 1);
      queue.splice(to, 0, moved);
      let index = s.index;
      if (from === s.index) index = to;
      else if (from < s.index && to >= s.index) index--;
      else if (from > s.index && to <= s.index) index++;
      set({ queue, index });
    },

    jumpTo: (i) => load(i),

    clearUpcoming: () => {
      const s = get();
      const keep = s.queue.slice(0, s.index + 1);
      set({ queue: keep, original: s.original ? keep.slice() : null });
    },

    // The radio becomes a new playlist, so what's playing keeps playing; the notice opens it.
    startRadio: async (track) => {
      const t = getT().player;
      toast(t.startingRadio(track.title));
      try {
        const related = await api.radio(track.id);
        const tracks = [track, ...related.filter((r) => r.id !== track.id)];
        const playlist = await useLibrary.getState().createPlaylist(t.radioName(track.title), tracks, undefined, { quiet: true });
        if (!playlist) return; // createPlaylist already said why
        toast(t.radioReady(playlist.name), "info", { label: t.openRadio, run: () => goTo(paths.playlist(playlist.id)) });
      } catch (e) {
        toast((e as Error).message, "error");
      }
    },

    toggle: () => {
      const s = get();
      const track = s.queue[s.index];
      if (!track) return;
      const kind = kindFor(track);
      const stale =
        !loaded ||
        loaded.id !== track.id ||
        loaded.kind !== kind ||
        (kind === "video" && loaded.quality !== s.quality) ||
        needsClipLookup(track, s.preferVideo);
      if (stale || s.status === "error") return load(s.index, { startAt: s.position });
      const media = mediaFor(kind);
      if (media.paused) play(media);
      else media.pause();
    },

    next: () => {
      const s = get();
      const next = nextIndex(s);
      if (next >= 0) return load(next);
      if (s.autoRadio) void continueWithRadio();
    },

    prev: () => {
      const s = get();
      if (s.position > 3 || s.index === 0) return get().seek(0);
      load(s.index - 1);
    },

    seek: (seconds) => {
      const t = Math.max(0, Math.min(seconds, get().duration || seconds));
      set({ position: t });
      if (reportsPlayback) scheduleNowPlaying();
      const media = activeMedia();
      const track = get().queue[get().index];
      if (!media || !track || loaded?.id !== track.id || media.readyState === 0) {
        pendingSeek = t;
        return;
      }
      lastListenTime = undefined;
      media.currentTime = t;
    },

    setVolume: (v) => {
      const volume = Math.max(0, Math.min(1, v));
      audio.volume = videoEl.volume = volume;
      const muted = volume === 0 ? true : false;
      audio.muted = videoEl.muted = muted;
      set({ volume, muted });
    },

    toggleMute: () => {
      const muted = !get().muted;
      audio.muted = videoEl.muted = muted;
      if (!muted && get().volume === 0) get().setVolume(0.6);
      else set({ muted });
    },

    toggleShuffle: () => {
      const s = get();
      const current = s.queue[s.index];
      if (!s.shuffle) {
        const rest = s.queue.filter((_, i) => i !== s.index);
        set({ shuffle: true, original: s.queue, queue: current ? [current, ...shuffled(rest)] : shuffled(rest), index: 0 });
        return;
      }
      const present = new Set(s.queue);
      const base = (s.original ?? s.queue).filter((t) => present.has(t));
      const extra = s.queue.filter((t) => !base.includes(t));
      const queue = [...base, ...extra];
      set({ shuffle: false, original: null, queue, index: Math.max(0, current ? queue.indexOf(current) : 0) });
    },

    cycleRepeat: () => {
      const order: Repeat[] = ["off", "all", "one"];
      set({ repeat: order[(order.indexOf(get().repeat) + 1) % order.length] });
    },

    setPreferVideo: (on) => {
      if (on && !capabilities.video) return;
      set({ preferVideo: on });
      reloadIfKindChanged();
    },

    setQuality: (quality) => {
      if (!capabilities.hdVideo) return;
      set({ quality });
      reloadIfKindChanged();
    },

    setAutoRadio: (autoRadio) => set({ autoRadio }),
  };
});

audio.volume = videoEl.volume = usePlayer.getState().volume;
audio.muted = videoEl.muted = usePlayer.getState().muted;

export const selectCurrent = (s: PlayerState): Track | null => s.queue[s.index] ?? null;

/** Whether the track can be shown as video (art tracks are audio with a still image). */

let nowPlayingTimer: ReturnType<typeof setTimeout> | undefined;
let reportsPlayback = false;

function scheduleNowPlaying(clear = false) {
  clearTimeout(nowPlayingTimer);
  nowPlayingTimer = setTimeout(() => {
    const { queue, index, status, position, duration } = usePlayer.getState();
    const track = queue[index];
    const stopped = clear || !track || status === "idle" || status === "error";
    reportsPlayback = !stopped;
    void api.nowPlaying(stopped ? null : { track, position, duration, playing: status !== "paused" }).catch(() => {});
  }, 1000);
}

usePlayer.subscribe((state, previous) => {
  const changed = state.queue[state.index] !== previous.queue[previous.index];
  if (changed || state.status !== previous.status) scheduleNowPlaying();
});

window.addEventListener("pagehide", () => {
  clearTimeout(nowPlayingTimer);
  if (reportsPlayback) void api.nowPlaying(null).catch(() => {});
});
window.addEventListener("pageshow", (event) => {
  if (event.persisted && reportsPlayback) scheduleNowPlaying();
});

// Persistence: resume the same queue and position after a reload.

function persist() {
  const s = usePlayer.getState();
  const data: Saved = {
    queue: s.queue.slice(0, 500),
    original: s.original?.slice(0, 500) ?? null,
    index: s.index,
    position: s.position,
    volume: s.volume,
    muted: s.muted,
    shuffle: s.shuffle,
    repeat: s.repeat,
    preferVideo: s.preferVideo,
    quality: s.quality,
    autoRadio: s.autoRadio,
  };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch {
    /* storage full or blocked */
  }
}
setInterval(persist, 4000);
addEventListener("pagehide", persist);
document.addEventListener("visibilitychange", () => document.visibilityState === "hidden" && persist());

// Media Session: lock-screen, headset and notification controls.

function setMetadata(track: Track) {
  systemMedia?.setTrack({ title: track.title, artist: track.artist, album: track.album ?? "", artwork: track.art || track.thumb });
  if (!("mediaSession" in navigator)) return;
  navigator.mediaSession.metadata = new MediaMetadata({
    title: track.title,
    artist: track.artist,
    album: track.album ?? "",
    artwork:
      track.kind === "video"
        ? [
            { src: track.art, sizes: "1280x720", type: "image/jpeg" },
            { src: track.thumb, sizes: "320x180", type: "image/jpeg" },
          ]
        : [{ src: track.art, sizes: "544x544", type: "image/jpeg" }],
  });
}

/** The phone's notification and lock screen. A track that is loading is about to play, so it counts as playing:
 *  reporting a pause between tracks would let Android stop the app in the background. */
function syncSystemMedia() {
  if (!systemMedia) return;
  const { status, position, duration } = usePlayer.getState();
  systemMedia.setState({ playing: status === "playing" || status === "loading", position, duration });
}

function syncPlaybackState() {
  syncSystemMedia();
  if (!("mediaSession" in navigator)) return;
  navigator.mediaSession.playbackState = usePlayer.getState().status === "playing" ? "playing" : "paused";
  syncPositionState();
}

function syncPositionState() {
  syncSystemMedia();
  const { duration, position } = usePlayer.getState();
  if (!("mediaSession" in navigator) || !navigator.mediaSession.setPositionState) return;
  if (!Number.isFinite(duration) || duration <= 0) return;
  try {
    navigator.mediaSession.setPositionState({ duration, position: Math.min(position, duration), playbackRate: 1 });
  } catch {
    /* some browsers reject transient states */
  }
}

if (systemMedia) {
  const p = () => usePlayer.getState();
  systemMedia.onAction((action, position) => {
    if (action === "play" && p().status !== "playing") p().toggle();
    else if (action === "pause" && p().status === "playing") p().toggle();
    else if (action === "next") p().next();
    else if (action === "previous") p().prev();
    else if (action === "seek" && position != null) p().seek(position);
  });
}

if ("mediaSession" in navigator) {
  const ms = navigator.mediaSession;
  const p = () => usePlayer.getState();
  const handlers: [MediaSessionAction, MediaSessionActionHandler][] = [
    ["play", () => p().status !== "playing" && p().toggle()],
    ["pause", () => p().status === "playing" && p().toggle()],
    ["previoustrack", () => p().prev()],
    ["nexttrack", () => p().next()],
    ["seekto", (d) => d.seekTime != null && p().seek(d.seekTime)],
    ["seekbackward", (d) => p().seek(p().position - (d.seekOffset ?? 10))],
    ["seekforward", (d) => p().seek(p().position + (d.seekOffset ?? 10))],
  ];
  for (const [action, handler] of handlers) {
    try {
      ms.setActionHandler(action, handler);
    } catch {
      /* action not supported */
    }
  }
  const restored = selectCurrent(usePlayer.getState());
  if (restored) setMetadata(restored);
}

/** The player's status line in the current language, or null when there is nothing to say. */
export function useStatusText(): string | null {
  const note = usePlayer((s) => s.statusText);
  const t = useT();
  if (note === null) return null;
  return typeof note === "string" ? t.player.status[note] : note.error;
}
