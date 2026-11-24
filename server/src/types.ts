export const ARTIST_ID = /^UC[\w-]{22}$/;

export interface Track {
  id: string;
  title: string;
  artist: string;
  artists?: { name: string; id?: string }[];
  album?: string;
  /** Release year, when known (artist pages). */
  year?: string;
  duration: number;
  thumb: string;
  art: string;
  kind: "song" | "video";
}

export interface Playlist {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  tracks: Track[];
}

export interface Library {
  favorites: Track[];
  playlists: Playlist[];
  history: Track[];
  /** When things changed, so two copies of a library can be merged (sync between the phone and the PC). */
  stamps?: LibraryStamps;
}

/** Times (ms) of the last change: when each favorite was added or removed, and when each playlist was deleted. */
export interface LibraryStamps {
  favoriteAdded?: Record<string, number>;
  favoriteRemoved?: Record<string, number>;
  playlistRemoved?: Record<string, number>;
}

import { tr, type Text } from "./i18n.js";

export const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;

/** Machine-readable reason so the web app can offer the right fix (e.g. "update yt-dlp"). */
export type ErrorCode = "tool_missing" | "maybe_outdated" | "bot_check";

/** An error for the person using the app: its text is translated into each request's language when sent. */
export class HttpError extends Error {
  constructor(
    public status: number,
    public text: Text,
    public code?: ErrorCode,
  ) {
    super(tr("en", text));
  }
}
