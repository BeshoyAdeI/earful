import { app, BrowserWindow, ipcMain, shell } from "electron";
import electronUpdater from "electron-updater";

const { autoUpdater } = electronUpdater;

/**
 * App updates from GitHub Releases (electron-updater). New versions are announced in the app; the person chooses
 * when to download (Settings) and when to restart. On Windows the download is differential: electron-updater
 * compares the release's .blockmap with the installed version's and fetches only the changed blocks.
 *
 * Installing in place is Windows-only: the macOS build isn't signed (Squirrel refuses unsigned updates) and Linux
 * packages are renamed for the release page, so on those the update opens the release to download it.
 */

export type UpdateState =
  | { status: "unsupported" | "idle" | "checking" | "latest"; current: string }
  | { status: "available"; current: string; version: string; notes: string; canInstall: boolean; url: string }
  | {
      status: "downloading";
      current: string;
      version: string;
      notes: string;
      percent: number;
      transferred: number;
      /** Bytes this update downloads (only the changed blocks when it's differential). */
      total: number;
      /** Size of the full installer, when the download is differential. */
      fullSize?: number;
    }
  | { status: "downloaded"; current: string; version: string; notes: string }
  | { status: "error"; current: string; message: string; version?: string };

const RELEASES = "https://github.com/BeshoyAdeI/earful/releases";
const FIRST_CHECK_MS = 15_000;
const CHECK_EVERY_MS = 6 * 3600_000;

const current = app.getVersion();
const canInstall = process.platform === "win32";
let state: UpdateState = { status: app.isPackaged || process.env.EARFUL_UPDATE_URL ? "idle" : "unsupported", current };
let notes = "";
let version = "";
let fullSize: number | undefined;

function set(next: UpdateState) {
  state = next;
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send("earful:update-state", state);
  }
}

/** GitHub release bodies come as HTML; the app shows them as plain text. */
function plainNotes(value: unknown): string {
  const raw = Array.isArray(value) ? value.map((n) => (n as { note?: string }).note ?? "").join("\n\n") : String(value ?? "");
  return raw
    .replace(/<\/(p|li|h\d)>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<li>/gi, "• ")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, 4000);
}

/** "1.2 MB" style sizes from electron-updater's log line, back to bytes. */
function bytesOf(text: string): number | undefined {
  const m = /([\d.,]+)\s*(B|KB|MB|GB)/i.exec(text);
  if (!m) return undefined;
  const scale = { B: 1, KB: 1024, MB: 1024 ** 2, GB: 1024 ** 3 }[m[2].toUpperCase() as "B" | "KB" | "MB" | "GB"];
  return Math.round(Number(m[1].replace(",", ".")) * scale);
}

export function setupUpdater() {
  ipcMain.handle("earful:update-get", () => state);
  ipcMain.handle("earful:update-check", () => check());
  ipcMain.handle("earful:update-download", () => download());
  ipcMain.handle("earful:update-install", () => install());
  ipcMain.handle("earful:update-open-release", () => shell.openExternal(`${RELEASES}/tag/v${version || current}`));
  if (state.status === "unsupported") return;

  // A local test feed (a folder served over HTTP) instead of GitHub.
  if (process.env.EARFUL_UPDATE_URL) {
    autoUpdater.setFeedURL({ provider: "generic", url: process.env.EARFUL_UPDATE_URL });
    autoUpdater.forceDevUpdateConfig = true;
  }
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.allowPrerelease = false;
  // electron-updater only tells how big a differential download is in its log.
  autoUpdater.logger = {
    info: (message?: unknown) => {
      const text = String(message ?? "");
      const full = /Full:\s*([\d.,]+\s*\w+)/i.exec(text);
      if (full) fullSize = bytesOf(full[1]);
    },
    warn: () => {},
    error: () => {},
    debug: () => {},
  };

  autoUpdater.on("checking-for-update", () => set({ status: "checking", current }));
  autoUpdater.on("update-not-available", () => set({ status: "latest", current }));
  autoUpdater.on("update-available", (info) => {
    version = info.version;
    notes = plainNotes(info.releaseNotes);
    set({ status: "available", current, version, notes, canInstall, url: `${RELEASES}/tag/v${version}` });
  });
  autoUpdater.on("download-progress", (p) => {
    set({
      status: "downloading",
      current,
      version,
      notes,
      percent: Math.min(100, p.percent),
      transferred: p.transferred,
      total: p.total,
      fullSize: fullSize && fullSize > p.total ? fullSize : undefined,
    });
  });
  autoUpdater.on("update-downloaded", (info) => {
    version = info.version;
    set({ status: "downloaded", current, version, notes });
  });
  autoUpdater.on("error", (error) => {
    // Offline or GitHub unreachable during a background check: stay quiet and try again later.
    if (state.status === "checking" || state.status === "idle") return set({ status: "idle", current });
    set({ status: "error", current, message: error?.message?.split("\n")[0] ?? "Update failed", version: version || undefined });
  });

  setTimeout(() => void check(), FIRST_CHECK_MS).unref();
  setInterval(() => {
    if (state.status === "idle" || state.status === "latest" || state.status === "error") void check();
  }, CHECK_EVERY_MS).unref();
}

/** "1.10.0" > "1.9.2", ignoring a leading "v". */
function newer(a: string, b: string): boolean {
  const pa = a.replace(/^v/, "").split(/[.-]/).map(Number);
  const pb = b.replace(/^v/, "").split(/[.-]/).map(Number);
  for (let i = 0; i < 3; i++) if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0);
  return false;
}

/** macOS and Linux: no update feed for them in the release, so ask GitHub for the latest release directly. */
async function checkRelease(): Promise<UpdateState> {
  set({ status: "checking", current });
  try {
    const res = await fetch("https://api.github.com/repos/BeshoyAdeI/earful/releases/latest", {
      headers: { accept: "application/vnd.github+json" },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new Error(String(res.status));
    const release = (await res.json()) as { tag_name: string; body?: string };
    if (!newer(release.tag_name, current)) return (set({ status: "latest", current }), state);
    version = release.tag_name.replace(/^v/, "");
    notes = plainNotes(release.body);
    set({ status: "available", current, version, notes, canInstall: false, url: `${RELEASES}/tag/v${version}` });
  } catch {
    set({ status: "idle", current });
  }
  return state;
}

async function check(): Promise<UpdateState> {
  if (state.status === "unsupported" || state.status === "downloading" || state.status === "downloaded") return state;
  if (!canInstall && !process.env.EARFUL_UPDATE_URL) return checkRelease();
  try {
    await autoUpdater.checkForUpdates();
  } catch {
    // reported through the "error" event
  }
  return state;
}

async function download(): Promise<UpdateState> {
  if (state.status !== "available" && !(state.status === "error" && version)) return state;
  if (!canInstall) {
    await shell.openExternal(`${RELEASES}/tag/v${version}`);
    return state;
  }
  fullSize = undefined;
  set({ status: "downloading", current, version, notes, percent: 0, transferred: 0, total: 0 });
  try {
    await autoUpdater.downloadUpdate();
  } catch {
    // reported through the "error" event
  }
  return state;
}

function install() {
  if (state.status !== "downloaded") return state;
  // Silent install, then start the new version.
  setImmediate(() => autoUpdater.quitAndInstall(true, true));
  return state;
}
