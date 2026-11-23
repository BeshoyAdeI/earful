import { create } from "zustand";
import type { Playlist } from "../lib/types";

/**
 * When each playlist was last played on this device, so the sidebar and the Library put the one you're playing
 * at the top (like recently played), instead of leaving it wherever it was created.
 */

const KEY = "earful:playlist-played";

function read(): Record<string, number> {
  try {
    const value = JSON.parse(localStorage.getItem(KEY) ?? "{}") as unknown;
    return value && typeof value === "object" ? (value as Record<string, number>) : {};
  } catch {
    return {};
  }
}

export const usePlaylistPlays = create<{ playedAt: Record<string, number>; markPlayed: (id: string) => void }>((set) => ({
  playedAt: read(),
  markPlayed: (id) =>
    set((s) => {
      const playedAt = { ...s.playedAt, [id]: Date.now() };
      try {
        localStorage.setItem(KEY, JSON.stringify(playedAt));
      } catch {
        /* storage unavailable: keep the order for this session */
      }
      return { playedAt };
    }),
}));

/** Most recently played first; playlists never played keep their own order after those. */
export function byRecentPlay(playlists: Playlist[], playedAt: Record<string, number>): Playlist[] {
  return playlists
    .map((p, i) => ({ p, i, at: playedAt[p.id] ?? 0 }))
    .sort((a, b) => b.at - a.at || a.i - b.i)
    .map(({ p }) => p);
}
