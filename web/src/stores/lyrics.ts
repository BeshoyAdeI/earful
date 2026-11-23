import { create } from "zustand";
import { api } from "../lib/api";
import type { Lyrics, Track } from "../lib/types";

type Result =
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; lyrics: Lyrics | null };

interface LyricsState {
  id: string | null;
  result: Result;
  load: (track: Track, retry?: boolean) => Promise<void>;
}

let request = 0;

export const useLyrics = create<LyricsState>((set, get) => ({
  id: null,
  result: { status: "loading" },
  load: async (track, retry) => {
    // Same song already loading or loaded: the player hands out new track objects for the same song.
    if (!retry && get().id === track.id && get().result.status !== "error") return;
    const current = ++request;
    set({ id: track.id, result: { status: "loading" } });
    try {
      const lyrics = await api.lyrics(track);
      if (current === request) set({ result: { status: "ready", lyrics } });
    } catch {
      if (current === request) set({ result: { status: "error" } });
    }
  },
}));
