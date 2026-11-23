import { Capacitor } from "@capacitor/core";
import { create } from "zustand";
import { getT } from "../i18n";
import { desktop, type UpdateState } from "../lib/desktop";
import { openSettings } from "./system";
import { toast } from "./ui";

/**
 * New versions of the app. The desktop app updates itself (desktop/src/updater.mts: downloads only the changed
 * blocks, then restarts into the new version). The phone apps can't replace themselves, so they check GitHub's
 * latest release and offer its download. The web app updates through its service worker and needs nothing here.
 */

const RELEASES = "https://github.com/BeshoyAdeI/earful/releases";
const LATEST = "https://api.github.com/repos/BeshoyAdeI/earful/releases/latest";
const PHONE_CHECK_EVERY_MS = 12 * 3600_000;

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
const current = __APP_VERSION__;
const announced = new Set<string>();

/** Tells once per version that an update is out, with a shortcut to Settings. */
function announce(state: UpdateState) {
  if (state.status !== "available" || announced.has(state.version)) return;
  announced.add(state.version);
  const t = getT().update;
  toast(t.available(state.version), "info", { label: t.view, run: openSettings });
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
      canInstall: false,
      url: (phone === "android" ? apk : phone === "ios" ? ipa : undefined) ?? release.html_url ?? `${RELEASES}/latest`,
    };
    set({ state });
    announce(state);
  } catch {
    set({ state: { status: "idle", current } });
  }
}

export const useAppUpdate = create<AppUpdateState>((set, get) => ({
  state: { status: desktop?.update || phone ? "idle" : "unsupported", current },

  check: async () => {
    if (desktop?.update) set({ state: await desktop.update.check() });
    else if (phone) await checkPhone(set);
  },
  download: async () => {
    const { state } = get();
    if (desktop?.update) set({ state: await desktop.update.download() });
    else if (state.status === "available") window.open(state.url, "_blank", "noopener");
  },
  install: async () => {
    if (desktop?.update) set({ state: await desktop.update.install() });
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
  setTimeout(() => void useAppUpdate.getState().check(), 10_000);
  setInterval(() => void useAppUpdate.getState().check(), PHONE_CHECK_EVERY_MS);
}

/** An update waits for the user: shown as the Settings dot. */
export const updateWaiting = (s: { state: UpdateState }) => s.state.status === "available" || s.state.status === "downloaded";
