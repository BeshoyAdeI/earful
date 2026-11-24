// Draws the Windows taskbar button icons (previous, play, pause, next) into src/thumbar/ as PNG files.
// Windows ignores icons made in memory (nativeImage.createFromBitmap), so the app loads these files instead.
// Run with Electron when the shapes change: npx electron scripts/thumbar-icons.mjs
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { app, nativeImage } from "electron";

const out = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "src", "thumbar");
const SIZE = 32; // the @2x file; the 1x file is this scaled down

const inTriangle = (x, y, [a, b, c]) => {
  const side = (p, q) => (x - q[0]) * (p[1] - q[1]) - (p[0] - q[0]) * (y - q[1]);
  const d1 = side(a, b), d2 = side(b, c), d3 = side(c, a);
  return !((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0));
};

/** White shapes on transparent, 4x4 supersampled for smooth edges. */
function draw(shapes) {
  const px = Buffer.alloc(SIZE * SIZE * 4);
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      let hits = 0;
      for (let sy = 0; sy < 4; sy++) {
        for (let sx = 0; sx < 4; sx++) {
          const fx = x + (sx + 0.5) / 4, fy = y + (sy + 0.5) / 4;
          if (shapes.some((s) => (s.tri ? inTriangle(fx, fy, s.tri) : fx >= s.rect[0] && fx <= s.rect[2] && fy >= s.rect[1] && fy <= s.rect[3]))) hits++;
        }
      }
      const alpha = Math.round((hits / 16) * 255);
      const i = (y * SIZE + x) * 4;
      px[i] = px[i + 1] = px[i + 2] = px[i + 3] = alpha; // BGRA, premultiplied white
    }
  }
  return nativeImage.createFromBitmap(px, { width: SIZE, height: SIZE });
}

const icons = {
  play: [{ tri: [[10, 7], [10, 25], [25, 16]] }],
  pause: [{ rect: [9, 7, 13.5, 25] }, { rect: [18.5, 7, 23, 25] }],
  next: [{ tri: [[7, 8], [7, 24], [20, 16]] }, { rect: [21, 8, 25, 24] }],
  prev: [{ tri: [[25, 8], [25, 24], [12, 16]] }, { rect: [7, 8, 11, 24] }],
};

app.whenReady().then(() => {
  mkdirSync(out, { recursive: true });
  for (const [name, shapes] of Object.entries(icons)) {
    const image = draw(shapes);
    writeFileSync(path.join(out, `${name}@2x.png`), image.toPNG());
    writeFileSync(path.join(out, `${name}.png`), image.resize({ width: 16, height: 16, quality: "best" }).toPNG());
  }
  console.log("icons written to", out);
  app.quit();
});
