import { create } from "zustand";
import { getT } from "../i18n";
import { toast } from "../stores/ui";
import { saveFile } from "./api";
import { MAX_PLAYLIST_FILE_BYTES, parsePlaylistFile, PlaylistFileError, PLAYLIST_FILE_MIME, serializePlaylistFile, type PlaylistFile } from "./playlistFile";
import type { Track } from "./types";

export const usePlaylistFile = create<{ files: PlaylistFile[] }>(() => ({ files: [] }));

export function closePlaylistFile(file: PlaylistFile) {
  usePlaylistFile.setState((state) => state.files[0] === file ? { files: state.files.slice(1) } : state);
}

export function openPlaylistFile(data: unknown, fileName?: string) {
  try {
    const file = parsePlaylistFile(data);
    usePlaylistFile.setState((state) => ({ files: [...state.files, file] }));
  } catch (error) {
    const t = getT().playlistFile;
    const message = error instanceof PlaylistFileError ? t[error.reason] : t.invalid;
    toast(fileName ? `${fileName} · ${message}` : message, "error");
  }
}

export async function openPlaylistFromDisk(file: File) {
  const t = getT().playlistFile;
  if (file.size > MAX_PLAYLIST_FILE_BYTES) return toast(t.tooLarge, "error");
  try {
    openPlaylistFile(await file.text(), file.name);
  } catch {
    toast(t.readFailed, "error");
  }
}

/** `id`: the playlist's own id (or a stable one, like an album's), so the receiver's copy can be updated later. */
export async function sharePlaylistFile(name: string, tracks: Track[], id?: string) {
  const t = getT().playlistFile;
  try {
    const filename = name.replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_").replace(/[. ]+$/, "").trim().slice(0, 120);
    await saveFile(`${filename || t.fallbackName}.earful`, serializePlaylistFile(name, tracks, __APP_VERSION__, id), PLAYLIST_FILE_MIME);
  } catch (error) {
    toast(error instanceof PlaylistFileError ? t[error.reason] : t.saveFailed, "error");
  }
}
