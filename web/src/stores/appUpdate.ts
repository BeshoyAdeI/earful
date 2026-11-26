import { Capacitor, registerPlugin } from "@capacitor/core";
import { create } from "zustand";
import { getT } from "../i18n";
import { desktop, type UpdateState } from "../lib/desktop";
import { openSettings } from "./system";
import { toast } from "./ui";

/**
 * New versions of the app. The desktop app updates itself (desktop/src/updater.mts: downloads only the changed
 * blocks, then restarts into the new version). The Android app does the same through EarfulUpdaterPlugin: it
 * downloads the APK from GitHub's latest release and hands it to Android, which closes and replaces Earful. iOS
 * can't replace itself, so it offers the release's download. The web app updates through its service worker.
 */

const RELEASES = "https://github.com/BeshoyAdeI/earful/releases";
const LATEST = "https://api.github.com/repos/BeshoyAdeI/earful/releases/latest";
const PHONE_CHECK_EVERY_MS = 12 * 3600_000;

/** mobile/android/.../EarfulUpdaterPlugin.java */
const AndroidUpdater = registerPlugin<{
  download(options: { url: string }): Promise<{ size: number }>;
  install(): Promise<void>;
  addListener(event: "progress", handler: (p: { transferred: number; total: number }) => void): Promise<{ remove: () => Promise<void> }>;
  addListener(event: "installFailed", handler: (e: { message: string }) => void): Promise<{ remove: () => Promise<void> }>;
}>("EarfulUpdater");

interface AppUpdateState {
  state: UpdateState;
  check: () => Promise<void>;
  download: () => Promise<void>;
  install: () => Promise<void>;
  openRelease: () => void;
}

/** "1.10.0" > "1.9.2": compares numerically, ignoring a leading "v". */
export function newer(a: string, b: string): boolean {
  const pa = a.replace(/^v/, "").split(/[.-]/).map(Number);
  const pb = b.replace(/^v/, "").split(/[.-]/).map(Number);
  for (let i = 0; i < 3; i++) if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0);
  return false;
}

const phone = Capacitor.isNativePlatform() ? Capacitor.getPlatform() : null;
/** The Android app downloads and installs updates itself (the whole APK, not only the changes). */
export const updatesInApp = phone === "android";
const current = __APP_VERSION__;
const announced = new Set<string>();

/** Tells once per version that an update is out, with a shortcut to Settings. */
function announce(state: UpdateState) {
  if (state.status !== "available" || announced.has(state.version)) return;
  announced.add(state.version);
  const t = getT().update;
  toast(t.available(state.version), "info", { label: t.view, run: () => openSettings("updates") });
}

async function checkPhone(set: (s: Partial<AppUpdateState>) => void) {
  set({ state: { status: "checking", current } });
  try {
    const res = await fetch(LATEST, { headers: { accept: "application/vnd.github+json" } });
    if (!res.ok) throw new Error(String(res.status));
    const release = (await res.json()) as { tag_name: string; body?: string; html_url: string; assets?: { name: string; browser_download_url: string }[] };
    if (!newer(release.tag_name, current)) return set({ state: { status: "latest", current } });
    const version = release.tag_name.replace(/^v/, "");
    const apk = release.assets?.find((a) => /-Android\.apk$/i.test(a.name))?.browser_download_url;
    const ipa = release.assets?.find((a) => /-iOS\.ipa$/i.test(a.name))?.browser_download_url;
    const state: UpdateState = {
      status: "available",
      current,
      version,
      notes: (release.body ?? "").slice(0, 4000),
      canInstall: updatesInApp && !!apk,
      url: (phone === "android" ? apk : phone === "ios" ? ipa : undefined) ?? release.html_url ?? `${RELEASES}/latest`,
    };
    set({ state });
    announce(state);
  } catch {
    set({ state: { status: "idle", current } });
  }
}

const messageOf = (e: unknown) => (e instanceof Error ? e.message : String(e));

async function downloadAndroid(state: Extract<UpdateState, { status: "available" }>, set: (s: Partial<AppUpdateState>) => void) {
  const { version, notes } = state;
  set({ state: { status: "downloading", current, version, notes, percent: 0, transferred: 0, total: 0 } });
  const progress = await AndroidUpdater.addListener("progress", ({ transferred, total }) => {
    const percent = total > 0 ? Math.min(100, (transferred / total) * 100) : 0;
    set({ state: { status: "downloading", current, version, notes, percent, transferred, total: Math.max(total, 0) } });
  });
  try {
    await AndroidUpdater.download({ url: state.url });
    set({ state: { status: "downloaded", current, version, notes } });
  } catch (e) {
    set({ state: { status: "error", current, version, message: messageOf(e) } });
  } finally {
    void progress.remove();
  }
}

export const useAppUpdate = create<AppUpdateState>((set, get) => ({
  state: { status: desktop?.update || phone ? "idle" : "unsupported", current },

  check: async () => {
    if (desktop?.update) set({ state: await desktop.update.check() });
    else if (phone) {
      // Don't drop an update that's being downloaded or waits to be installed.
      const { status } = get().state;
      if (status !== "downloading" && status !== "downloaded") await checkPhone(set);
    }
  },
  download: async () => {
    const { state } = get();
    if (desktop?.update) set({ state: await desktop.update.download() });
    else if (state.status === "available" && state.canInstall) await downloadAndroid(state, set);
    else if (state.status === "available") window.open(state.url, "_blank", "noopener");
    else if (state.status === "error" && state.version) {
      // Retry: look the release up again, then download it.
      await checkPhone(set);
      const next = get().state;
      if (next.status === "available" && next.canInstall) await downloadAndroid(next, set);
    }
  },
  install: async () => {
    const { state } = get();
    if (desktop?.update) set({ state: await desktop.update.install() });
    else if (updatesInApp && state.status === "downloaded") {
      try {
        // Android takes over from here: it may ask to allow installs or to confirm, then closes and replaces Earful.
        await AndroidUpdater.install();
      } catch (e) {
        set({ state: { status: "error", current, version: state.version, message: messageOf(e) } });
      }
    }
  },
  openRelease: () => {
    const { state } = get();
    if (desktop?.update) void desktop.update.openRelease();
    else window.open(state.status === "available" ? state.url : `${RELEASES}/latest`, "_blank", "noopener");
  },
}));

// Start listening as soon as the app loads.
if (desktop?.update) {
  void desktop.update.get().then((state) => {
    useAppUpdate.setState({ state });
    announce(state);
  });
  desktop.update.onState((state) => {
    useAppUpdate.setState({ state });
    announce(state);
  });
} else if (phone) {
  if (updatesInApp) {
    void AndroidUpdater.addListener("installFailed", ({ message }) => {
      const s = useAppUpdate.getState().state;
      if (s.status === "downloaded" || s.status === "available") {
        useAppUpdate.setState({ state: { status: "error", current, version: s.version, message } });
      }
    });
  }
  setTimeout(() => void useAppUpdate.getState().check(), 10_000);
  setInterval(() => void useAppUpdate.getState().check(), PHONE_CHECK_EVERY_MS);
}

/** An update waits for the user: shown as the Settings dot. */
export const updateWaiting = (s: { state: UpdateState }) => s.state.status === "available" || s.state.status === "downloaded";
