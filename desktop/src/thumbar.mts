import { nativeImage, type BrowserWindow, type NativeImage } from "electron";

/**
 * Windows taskbar thumbnail buttons (previous, play/pause, next) under the window's preview. The web app reports
 * what's playing ("earful:media"); a click goes back to it as "earful:media-command". The icons are drawn here, so
 * no image files are needed.
 */

export interface MediaState {
  playing: boolean;
  hasTrack: boolean;
  title?: string;
}

type Point = [number, number];
type Shape = { tri: [Point, Point, Point] } | { rect: [number, number, number, number] };

const SIZE = 32; // drawn at 2x for a 16 px button

const inTriangle = (x: number, y: number, [a, b, c]: [Point, Point, Point]) => {
  const side = (p: Point, q: Point) => (x - q[0]) * (p[1] - q[1]) - (p[0] - q[0]) * (y - q[1]);
  const d1 = side(a, b), d2 = side(b, c), d3 = side(c, a);
  return !((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0));
};

/** White shapes on transparent, 4x4 supersampled for smooth edges. */
function icon(shapes: Shape[]): NativeImage {
  const px = Buffer.alloc(SIZE * SIZE * 4);
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      let hits = 0;
      for (let sy = 0; sy < 4; sy++) {
        for (let sx = 0; sx < 4; sx++) {
          const fx = x + (sx + 0.5) / 4, fy = y + (sy + 0.5) / 4;
          if (shapes.some((s) => ("tri" in s ? inTriangle(fx, fy, s.tri) : fx >= s.rect[0] && fx <= s.rect[2] && fy >= s.rect[1] && fy <= s.rect[3]))) hits++;
        }
      }
      const alpha = Math.round((hits / 16) * 255);
      const i = (y * SIZE + x) * 4;
      // BGRA, premultiplied: white at `alpha`.
      px[i] = px[i + 1] = px[i + 2] = px[i + 3] = alpha;
    }
  }
  return nativeImage.createFromBitmap(px, { width: SIZE, height: SIZE, scaleFactor: 2 });
}

let icons: Record<"prev" | "play" | "pause" | "next", NativeImage> | null = null;
const getIcons = () =>
  (icons ??= {
    play: icon([{ tri: [[10, 7], [10, 25], [25, 16]] }]),
    pause: icon([{ rect: [9, 7, 13.5, 25] }, { rect: [18.5, 7, 23, 25] }]),
    next: icon([{ tri: [[7, 8], [7, 24], [20, 16]] }, { rect: [21, 8, 25, 24] }]),
    prev: icon([{ tri: [[25, 8], [25, 24], [12, 16]] }, { rect: [7, 8, 11, 24] }]),
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
export function setThumbar(win: BrowserWindow, state: MediaState, labels: ThumbarLabels, send: (command: "prev" | "toggle" | "next") => void) {
  if (process.platform !== "win32" || win.isDestroyed()) return;
  const i = getIcons();
  const flags: ("hidden" | "enabled")[] = state.hasTrack ? ["enabled"] : ["hidden"];
  win.setThumbarButtons([
    { tooltip: labels.prev, icon: i.prev, flags, click: () => send("prev") },
    { tooltip: state.playing ? labels.pause : labels.play, icon: state.playing ? i.pause : i.play, flags, click: () => send("toggle") },
    { tooltip: labels.next, icon: i.next, flags, click: () => send("next") },
  ]);
}
