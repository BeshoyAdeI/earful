import { create } from "zustand";
import { getT } from "../i18n";
import { api, type DownloadItem, type OfflineTrack } from "../lib/api";
import type { Track } from "../lib/types";
import { toast } from "./ui";

interface DownloadsState {
  dir: string;
  items: Record<string, DownloadItem>;
  offlineTracks: OfflineTrack[];
  load: () => Promise<void>;
  loadOffline: () => Promise<void>;
  isDownloaded: (id: string) => boolean;
  statusOf: (id: string) => DownloadItem["status"] | undefined;
  download: (tracks: Track[]) => Promise<void>;
  remove: (id: string) => Promise<void>;
}

let poll: ReturnType<typeof setTimeout> | undefined;
let revision = 0;
let offlineRevision = 0;

export const useDownloads = create<DownloadsState>((set, get) => ({
  dir: "",
  items: {},
  offlineTracks: [],
  isDownloaded: (id) => get().items[id]?.status === "done",
  statusOf: (id) => get().items[id]?.status,
  loadOffline: async () => {
    const request = ++offlineRevision;
    try {
      const { tracks } = await api.offline();
      if (request === offlineRevision) set({ offlineTracks: tracks });
    } catch {
      // Keep the last available collection during a transient error.
    }
  },
  load: async () => {
    const request = ++revision;
    clearTimeout(poll);
    try {
      const { dir, items } = await api.downloads();
      if (request !== revision) return;
      const previous = get().items;
      const next = Object.fromEntries(items.map((item) => [item.track.id, item]));
      set({ dir, items: next });
      if (items.some((item) => item.status === "error" && previous[item.track.id]?.status !== "error")) {
        toast(getT().offline.downloadFailed, "error");
      }
      if (items.some((item) => item.status === "done" && previous[item.track.id]?.status !== "done") ||
        Object.values(previous).some((item) => item.status === "done" && next[item.track.id]?.status !== "done")) {
        void get().loadOffline();
      }
    } catch {
      // Try again while a known transfer is still pending.
    } finally {
      if (request === revision && Object.values(get().items).some((item) => item.status === "queued" || item.status === "downloading")) {
        poll = setTimeout(() => void get().load(), 1000);
      }
    }
  },
  download: async (tracks) => {
    if (!tracks.length) return;
    try {
      const { queued, skipped } = await api.download(tracks);
      const t = getT().offline;
      toast(queued ? t.downloadingSongs(queued, skipped) : t.alreadyAvailable);
      await get().load();
    } catch {
      toast(getT().offline.downloadFailed, "error");
    }
  },
  remove: async (id) => {
    try {
      await api.removeDownload(id);
      await Promise.all([get().load(), get().loadOffline()]);
    } catch {
      toast(getT().offline.removeFailed, "error");
    }
  },
}));
