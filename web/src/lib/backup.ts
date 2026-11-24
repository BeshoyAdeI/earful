import { getLang, getT, isLang, useI18n } from "../i18n";
import { usePlayer } from "../player/player";
import { cleanAppearance, currentAppearance, useAppearance, type Appearance } from "../stores/appearance";
import { useLibrary } from "../stores/library";
import { useUi } from "../stores/ui";
import { api, saveFile, type ImportResult } from "./api";
import type { PlayEvent } from "./apiTypes";
import type { Library } from "./types";

/**
 * Portable backup of a Earful instance: the library plus a few preferences.
 * Version 1 is read by every Earful from this release on; bump `version` only for breaking changes.
 */
export interface Backup {
  format: "earful-backup";
  version: 1;
  exportedAt: string;
  app: string;
  library: Library;
  /** Every listen, for the stats (backups from 1.6.10 on). Importing always merges them. */
  plays?: PlayEvent[];
  settings?: {
    theme?: "dark" | "light";
    lang?: string;
    appearance?: Partial<Appearance>;
    preferVideo?: boolean;
    quality?: "sd" | "hd";
    autoRadio?: boolean;
    volume?: number;
  };
}

export async function createBackup(): Promise<Backup> {
  const [library, plays] = await Promise.all([api.library(), api.allPlays().catch(() => undefined)]);
  const p = usePlayer.getState();
  return {
    format: "earful-backup",
    version: 1,
    exportedAt: new Date().toISOString(),
    app: `Earful ${__APP_VERSION__}`,
    library: { favorites: library.favorites, playlists: library.playlists, history: library.history, stamps: library.stamps },
    plays,
    settings: {
      theme: useUi.getState().theme,
      lang: getLang(),
      appearance: currentAppearance(),
      preferVideo: p.preferVideo,
      quality: p.quality,
      autoRadio: p.autoRadio,
      volume: p.volume,
    },
  };
}

/** Saves the backup as a file: a download in browsers, "Save as" on desktop, the share sheet on Android. */
export function downloadBackup(backup: Backup): Promise<void> {
  return saveFile(`earful-backup-${backup.exportedAt.slice(0, 10)}.earful.json`, JSON.stringify(backup, null, 2));
}

export async function readBackup(file: File): Promise<Backup> {
  let data: Partial<Backup>;
  try {
    data = JSON.parse(await file.text()) as Partial<Backup>;
  } catch {
    throw new Error(getT().backup.unreadable);
  }
  // Backups from Musike, the app Earful is built on, have the same contents under another name.
  if ((data?.format as string) === "musike-backup") data.format = "earful-backup";
  if (data?.format !== "earful-backup" || !data.library) throw new Error(getT().backup.notBackup);
  if (typeof data.version !== "number" || data.version > 1) {
    throw new Error(getT().backup.newer);
  }
  return data as Backup;
}

export function summarize(backup: Backup) {
  const lib = backup.library;
  const playlists = Array.isArray(lib.playlists) ? lib.playlists : [];
  return {
    playlists: playlists.length,
    playlistTracks: playlists.reduce((n, p) => n + (Array.isArray(p.tracks) ? p.tracks.length : 0), 0),
    favorites: Array.isArray(lib.favorites) ? lib.favorites.length : 0,
    history: Array.isArray(lib.history) ? lib.history.length : 0,
    plays: Array.isArray(backup.plays) ? backup.plays.length : 0,
    exportedAt: new Date(backup.exportedAt),
  };
}

export async function restoreBackup(backup: Backup, mode: "merge" | "replace", applySettings: boolean): Promise<ImportResult> {
  const result = await api.importLibrary(backup, mode);
  const s = backup.settings;
  if (applySettings && s) {
    const player = usePlayer.getState();
    if (s.theme === "dark" || s.theme === "light") useUi.getState().setTheme(s.theme);
    if (isLang(s.lang)) useI18n.getState().setLang(s.lang);
    if (s.appearance && typeof s.appearance === "object") useAppearance.getState().set(cleanAppearance(s.appearance));
    if (typeof s.autoRadio === "boolean") player.setAutoRadio(s.autoRadio);
    if (typeof s.volume === "number") player.setVolume(s.volume);
    if (s.quality === "sd" || s.quality === "hd") player.setQuality(s.quality);
    if (typeof s.preferVideo === "boolean") player.setPreferVideo(s.preferVideo);
  }
  await useLibrary.getState().load();
  return result;
}
