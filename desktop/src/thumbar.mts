import path from "node:path";
import { fileURLToPath } from "node:url";
import { nativeImage, type BrowserWindow, type NativeImage } from "electron";

/**
 * Windows taskbar thumbnail buttons (previous, play/pause, next) under the window's preview. The web app reports
 * what's playing ("earful:media"); a click goes back to it as "earful:media-command".
 */

export interface MediaState {
  playing: boolean;
  hasTrack: boolean;
  title?: string;
}

// Windows ignores icons made in memory (nativeImage.createFromBitmap), so they're PNG files next to this script,
// drawn by scripts/thumbar-icons.mjs (copied to dist/thumbar by scripts/bundle.mjs; the @2x files load with them).
const iconDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "thumbar");

let icons: Record<"prev" | "play" | "pause" | "next", NativeImage> | null = null;
const getIcons = () =>
  (icons ??= {
    prev: nativeImage.createFromPath(path.join(iconDir, "prev.png")),
    play: nativeImage.createFromPath(path.join(iconDir, "play.png")),
    pause: nativeImage.createFromPath(path.join(iconDir, "pause.png")),
    next: nativeImage.createFromPath(path.join(iconDir, "next.png")),
  });

export interface ThumbarLabels {
  prev: string;
  play: string;
  pause: string;
  next: string;
}

/**
 * Shows the buttons for `state` on `win`; `send` passes a click back to the page. Windows only lets the buttons be
 * added once, so the same three are always set and hidden while nothing is loaded (an empty list first would lock
 * the toolbar at no buttons).
 */
export function setThumbar(win: BrowserWindow, state: MediaState, labels: ThumbarLabels, send: (command: "prev" | "toggle" | "next") => void): boolean {
  if (process.platform !== "win32" || win.isDestroyed()) return false;
  const i = getIcons();
  // No flag at all for a shown button: Windows refuses the whole set when "enabled" is passed.
  const flags: "hidden"[] = state.hasTrack ? [] : ["hidden"];
  return win.setThumbarButtons([
    { tooltip: labels.prev, icon: i.prev, flags, click: () => send("prev") },
    { tooltip: state.playing ? labels.pause : labels.play, icon: state.playing ? i.pause : i.play, flags, click: () => send("toggle") },
    { tooltip: labels.next, icon: i.next, flags, click: () => send("next") },
  ]);
}
