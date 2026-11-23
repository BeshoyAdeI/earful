import { en } from "../i18n/en";
import { pt } from "../i18n/pt";
import type { Lang } from "../i18n";
import { api, type Stats } from "./api";
import { accentTextFor, DEFAULT_ACCENT, isHex } from "./accent";
import { minutesListened, playCount } from "./profileStats";

export type ShareFormat = "story" | "square";

interface Options {
  format: ShareFormat;
  name: string;
  rangeLabel: string;
  accent: string;
  theme: "dark" | "light";
  lang: Lang;
}

async function loadCover(url: string): Promise<HTMLImageElement | null> {
  let src: string | undefined;
  try {
    if (!url) return null;
    src = await api.imageSrc(url);
    const image = new Image();
    return await new Promise<HTMLImageElement | null>((resolve) => {
      const finish = (value: HTMLImageElement | null) => {
        clearTimeout(timer);
        image.onload = image.onerror = null;
        if (!value) image.removeAttribute("src");
        resolve(value);
      };
      const timer = setTimeout(() => finish(null), 9_000);
      image.onload = () => finish(image);
      image.onerror = () => finish(null);
      image.src = src!;
    });
  } catch {
    return null;
  } finally {
    if (src?.startsWith("blob:")) URL.revokeObjectURL(src);
  }
}

export async function renderStatsImage(stats: Stats, opts: Options): Promise<Blob> {
  const { format, name, rangeLabel, theme, lang } = opts;
  const t = lang === "pt-BR" ? pt : en;
  const p = t.profile;
  const story = format === "story";
  const canvas = document.createElement("canvas");
  canvas.width = 1080;
  canvas.height = story ? 1920 : 1080;
  const context = canvas.getContext("2d");
  if (!context) throw new Error(p.imageError);
  const ctx: CanvasRenderingContext2D = context;

  const dark = theme === "dark";
  const accent = isHex(opts.accent) ? opts.accent : DEFAULT_ACCENT;
  const bg = dark ? "#0b0c0f" : "#f5f6f4";
  const fg = dark ? "#f6f7f4" : "#161a15";
  const muted = dark ? "#b5bdb6" : "#48534a";
  const ink = accentTextFor(accent, theme);
  const surface = dark ? "#1a201b" : "#ffffff";
  const left = story ? 72 : 60;
  const right = canvas.width - left;
  const width = right - left;
  const artist = stats.topArtists[0];
  const album = stats.topAlbums[0];
  const songs = stats.topSongs.slice(0, 5);
  const covers = new Map([...new Set([artist?.thumb, album?.thumb, ...songs.map(({ track }) => track.thumb)])]
    .filter((url): url is string => !!url).map((url) => [url, loadCover(url)]));
  const fontFamily = '"Geist Variable", system-ui, sans-serif';
  await document.fonts?.load(`600 48px ${fontFamily}`).catch(() => {});
  await document.fonts?.ready;
  const images = new Map(await Promise.all([...covers].map(async ([url, image]) => [url, await image] as const)));
  const graphemes = new Intl.Segmenter(lang, { granularity: "grapheme" });

  function roundedPath(x: number, y: number, w: number, h: number, radius: number) {
    ctx.beginPath();
    if (typeof ctx.roundRect === "function") {
      ctx.roundRect(x, y, w, h, radius);
    } else {
      ctx.moveTo(x + radius, y);
      ctx.arcTo(x + w, y, x + w, y + h, radius);
      ctx.arcTo(x + w, y + h, x, y + h, radius);
      ctx.arcTo(x, y + h, x, y, radius);
      ctx.arcTo(x, y, x + w, y, radius);
      ctx.closePath();
    }
  }

  function rect(x: number, y: number, w: number, h: number, radius: number, color: string) {
    roundedPath(x, y, w, h, radius);
    ctx.fillStyle = color;
    ctx.fill();
  }

  function text(value: string, x: number, y: number, size: number, limit: number, color = fg, weight = 600) {
    ctx.font = `${weight} ${size}px ${fontFamily}`;
    ctx.fillStyle = color;
    ctx.textAlign = "left";
    const firstLetter = value.match(/\p{Letter}/u)?.[0] ?? "";
    ctx.direction = /[\p{Script=Arabic}\p{Script=Hebrew}]/u.test(firstLetter) ? "rtl" : "ltr";
    if (ctx.measureText(value).width > limit) {
      const parts = Array.from(graphemes.segment(value), ({ segment }) => segment);
      while (parts.length && ctx.measureText(parts.join("") + "…").width > limit) parts.pop();
      value = parts.join("") + "…";
    }
    ctx.fillText(value, x, y);
  }

  function mark(x: number, y: number, scale: number, color: string) {
    for (const [a, b, w, h] of [[10, 10, 7, 28], [10, 10, 28, 7], [10, 20.5, 21, 7], [10, 31, 28, 7]]) {
      rect(x + a * scale, y + b * scale, w * scale, h * scale, 3.5 * scale, color);
    }
  }

  function cover(url: string | undefined, x: number, y: number, size: number, radius: number) {
    const image = url ? images.get(url) : null;
    rect(x, y, size, size, radius, surface);
    if (!image?.naturalWidth || !image.naturalHeight) {
      mark(x + size / 4, y + size / 4, size / 96, muted);
      return;
    }
    ctx.save();
    roundedPath(x, y, size, size, radius);
    ctx.clip();
    const edge = Math.min(image.naturalWidth, image.naturalHeight);
    ctx.drawImage(image, (image.naturalWidth - edge) / 2, (image.naturalHeight - edge) / 2, edge, edge, x, y, size, size);
    ctx.restore();
  }

  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const gradient = ctx.createLinearGradient(0, 0, canvas.width, canvas.height);
  gradient.addColorStop(0, accent + (dark ? "45" : "56"));
  gradient.addColorStop(0.55, accent + "00");
  gradient.addColorStop(1, accent + (dark ? "26" : "30"));
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const brandY = story ? 74 : 41;
  mark(left - 10, brandY - 15, 1.1, ink);
  text("earful", left + 45, brandY + 24, 37, width - 45);
  text(name, left, story ? 218 : 125, story ? 66 : 47, width);
  text(rangeLabel, left, story ? 272 : 165, story ? 32 : 25, width, muted, 500);
  text(minutesListened(stats.totals.seconds, t), left, story ? 474 : 287, story ? 140 : 112, width, ink, 750);
  text(p.minutesLabel, left, story ? 534 : 325, story ? 34 : 26, width, muted, 500);

  const heroY = story ? 609 : 359;
  const heroSize = story ? 273 : 109;
  if (artist) {
    rect(left, heroY, width, heroSize, 24, surface);
    cover(artist.thumb, left, heroY, heroSize, 24);
    const x = left + heroSize + (story ? 33 : 22);
    const available = right - x - 22;
    text(p.topArtist, x, heroY + (story ? 75 : 30), story ? 28 : 20, available, muted, 500);
    text(artist.name, x, heroY + (story ? 151 : 66), story ? 55 : 35, available);
    text(p.chartValue(playCount(artist.plays, t), minutesListened(artist.seconds, t)), x,
      heroY + (story ? 207 : 94), story ? 25 : 19, available, muted, 500);
  }

  const songsY = story ? 976 : 507;
  const row = story ? 105 : 58;
  if (songs.length) text(p.topSongs, left, songsY, story ? 38 : 29, width);
  songs.forEach(({ track, plays }, index) => {
    const y = songsY + (story ? 24 : 12) + row * index;
    const size = row - (story ? 17 : 8);
    cover(track.thumb, left, y, size, story ? 15 : 10);
    const x = left + size + 16;
    const counts = playCount(plays, t);
    const countWidth = story ? 225 : 215;
    text(track.title, x, y + (story ? 37 : 22), story ? 32 : 24, right - x - countWidth - 12);
    text(track.artist, x, y + (story ? 72 : 45), story ? 25 : 18, right - x - countWidth - 12, muted, 500);
    text(counts, right - countWidth, y + (story ? 51 : 30), story ? 26 : 21, countWidth, ink);
  });

  const albumY = story ? 1548 : 829;
  const albumSize = story ? 121 : 70;
  if (album) {
    cover(album.thumb, left, albumY, albumSize, 14);
    const x = left + albumSize + 18;
    text(p.topAlbum, x, albumY + (story ? 35 : 17), story ? 25 : 17, right - x, muted, 500);
    text(album.name, x, albumY + (story ? 78 : 45), story ? 35 : 26, right - x);
    text(album.artist, x, albumY + (story ? 109 : 67), story ? 23 : 16, right - x, muted, 500);
  }

  const countersY = story ? 1729 : 943;
  const counterWidth = (width - 24) / 3;
  const counters: [string, number][] = [[p.plays, stats.totals.plays], [p.songs, stats.totals.songs], [p.artists, stats.totals.artists]];
  counters.forEach(([label, value], index) => {
    const x = left + (counterWidth + 12) * index;
    rect(x, countersY, counterWidth, story ? 119 : 84, 18, surface);
    text(value.toLocaleString(t.locale), x + 15, countersY + (story ? 56 : 39), story ? 44 : 34, counterWidth - 30, ink);
    text(label, x + 15, countersY + (story ? 93 : 66), story ? 26 : 20, counterWidth - 30, muted, 500);
  });

  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error(p.imageError)), "image/png");
  });
}
