import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { open } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { app, BrowserWindow, ipcMain, Menu, screen, shell } from "electron";
import type { RunningServer } from "../../server/src/app.js";
import { isPlaylistFileName, MAX_PLAYLIST_FILE_BYTES } from "../../web/src/lib/playlistFile.js";
import { backupLibraryOnUpdate } from "./backup.js";
import { setThumbar, type MediaState } from "./thumbar.mjs";
import { setupUpdater } from "./updater.mjs";

// No top-level await in this file: Electron only fires "ready" after the entry module finishes
// evaluating, so awaiting it at the top level would hang forever.

const here = path.dirname(fileURLToPath(import.meta.url));
const PORT = 4280; // fixed so the web origin (and its saved settings) stays the same between launches
const isMac = process.platform === "darwin";

if (!app.requestSingleInstanceLock()) {
  app.quit();
  process.exit(0);
}

// Everything the user owns lives in their profile, so updates and reinstalls keep it.
const userData = app.getPath("userData");
process.env.EARFUL_DATA_DIR = path.join(userData, "data");
process.env.EARFUL_CACHE_DIR = path.join(userData, "cache");
process.env.EARFUL_BIN_DIR = path.join(userData, "bin");
const downloadDir = path.resolve(process.env.EARFUL_DOWNLOAD_DIR ?? path.join(app.getPath("music"), "Earful"));
process.env.EARFUL_DOWNLOAD_DIR = downloadDir;
process.env.EARFUL_WEB_DIST = app.isPackaged ? path.join(process.resourcesPath, "web") : path.resolve(here, "..", "..", "web", "dist");

// A copy of the library from before each update, in userData/backups (the installer makes one too).
backupLibraryOnUpdate(userData, app.getVersion());

// The server reads its config when first imported, so load it only after the env above is set.
const loadServer = async () => ({
  ...(await import("../../server/src/app.js")),
  ...(await import("../../server/src/bootstrap.js")),
  ...(await import("../../server/src/tools.js")),
  ...(await import("../../server/src/i18n.js")),
  HttpError: (await import("../../server/src/types.js")).HttpError,
});

const THEME = {
  dark: { color: "#0B0C0F", symbolColor: "#ECEEF2" },
  light: { color: "#E9EBEF", symbolColor: "#12141A" },
};
const TITLEBAR_HEIGHT = 40;

interface WindowState {
  width: number;
  height: number;
  x?: number;
  y?: number;
  maximized?: boolean;
}

const stateFile = path.join(userData, "window.json");

// The language picked in the web app, kept here so the splash screen (shown before the web app loads) uses it too.
type Lang = "en" | "pt-BR";
const settingsFile = path.join(userData, "settings.json");
const isLang = (v: unknown): v is Lang => v === "en" || v === "pt-BR";

function readLang(): Lang {
  try {
    const { lang } = JSON.parse(readFileSync(settingsFile, "utf8")) as { lang?: unknown };
    if (isLang(lang)) return lang;
  } catch {
    // first launch
  }
  return "en";
}

let lang = readLang();

function readWindowState(): WindowState {
  try {
    const s = JSON.parse(readFileSync(stateFile, "utf8")) as WindowState;
    // Ignore a position that is no longer on any screen (monitor unplugged).
    const onScreen = screen
      .getAllDisplays()
      .some(({ workArea: a }) => s.x !== undefined && s.y !== undefined && s.x >= a.x - 50 && s.y >= a.y - 50 && s.x < a.x + a.width && s.y < a.y + a.height);
    return onScreen ? s : { width: s.width, height: s.height, maximized: s.maximized };
  } catch {
    return { width: 1280, height: 820 };
  }
}

function saveWindowState(win: BrowserWindow) {
  try {
    writeFileSync(stateFile, JSON.stringify({ ...win.getNormalBounds(), maximized: win.isMaximized() }));
  } catch {
    /* not critical */
  }
}

function createSplash(): BrowserWindow {
  const splash = new BrowserWindow({
    width: 420,
    height: 300,
    frame: false,
    resizable: false,
    center: true,
    show: false,
    icon: path.join(here, "icon.png"),
    backgroundColor: THEME.dark.color,
    webPreferences: { preload: path.join(here, "preload.cjs"), sandbox: true, contextIsolation: true },
  });
  void splash.loadFile(path.join(here, "splash.html"), { query: { lang } });
  splash.once("ready-to-show", () => splash.show());
  return splash;
}

function createMainWindow(url: string): BrowserWindow {
  const state = readWindowState();
  const win = new BrowserWindow({
    ...state,
    minWidth: 380,
    minHeight: 560,
    show: false,
    title: "Earful",
    icon: path.join(here, "icon.png"),
    backgroundColor: THEME.dark.color,
    // Our own title bar (drawn by the web app) with the native window buttons on top of it:
    // macOS traffic lights on the left, centred in the bar; Windows and Linux controls on the right.
    titleBarStyle: "hidden",
    ...(isMac
      ? { trafficLightPosition: { x: 14, y: (TITLEBAR_HEIGHT - 14) / 2 } }
      : { titleBarOverlay: { ...THEME.dark, height: TITLEBAR_HEIGHT } }),
    webPreferences: {
      preload: path.join(here, "preload.cjs"),
      contextIsolation: true,
      sandbox: true,
      spellcheck: false,
      autoplayPolicy: "no-user-gesture-required",
    },
  });

  win.once("ready-to-show", () => {
    if (state.maximized) win.maximize();
    win.show();
  });
  // The taskbar buttons can only be set once Windows has made the window's taskbar button, a moment after it
  // first shows; they're set again whenever the window is shown, since Windows can drop them while it's hidden.
  win.on("show", () => {
    thumbarReady = false;
    setTimeout(() => {
      thumbarReady = true;
      showThumbar(win);
    }, 1500);
  });
  win.on("close", () => saveWindowState(win));

  // Links to YouTube etc. open in the user's browser, never inside the app.
  win.webContents.setWindowOpenHandler(({ url: target }) => {
    if (/^https?:\/\//.test(target)) void shell.openExternal(target);
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (event, target) => {
    if (!target.startsWith(url)) {
      event.preventDefault();
      if (/^https?:\/\//.test(target)) void shell.openExternal(target);
    }
  });

  void win.loadURL(url);
  return win;
}

let mainWindow: BrowserWindow | null = null;
let server: RunningServer | null = null;
let playlistReady = false;
let deliveringPlaylists = false;
const playlistPaths: string[] = [];

async function readPlaylistFile(filename: string) {
  const fileName = path.basename(filename);
  try {
    const file = await open(filename, "r");
    try {
      const stat = await file.stat();
      if (!stat.isFile()) return { fileName, error: "readFailed" };
      if (stat.size > MAX_PLAYLIST_FILE_BYTES) return { fileName, error: "tooLarge" };

      const buffer = Buffer.alloc(stat.size + 1);
      let length = 0;
      while (length < buffer.length) {
        const { bytesRead } = await file.read(buffer, length, buffer.length - length, null);
        if (!bytesRead) break;
        length += bytesRead;
      }
      if (length > MAX_PLAYLIST_FILE_BYTES) return { fileName, error: "tooLarge" };
      if (length !== stat.size) return { fileName, error: "readFailed" };
      return { fileName, text: buffer.toString("utf8", 0, length) };
    } finally {
      await file.close();
    }
  } catch {
    return { fileName, error: "readFailed" };
  }
}

async function deliverPlaylists() {
  if (deliveringPlaylists) return;
  deliveringPlaylists = true;
  try {
    while (playlistReady && mainWindow && !mainWindow.isDestroyed() && playlistPaths.length) {
      const win = mainWindow;
      const file = await readPlaylistFile(playlistPaths[0]!);
      if (!playlistReady || mainWindow !== win || win.isDestroyed()) continue;
      win.webContents.send("earful:open-playlist", file);
      playlistPaths.shift();
    }
  } finally {
    deliveringPlaylists = false;
  }
}

function queuePlaylists(argv: string[], directory: string) {
  for (const argument of argv) {
    try {
      const filename = argument.startsWith("file://") ? fileURLToPath(argument) : argument;
      if (!filename.startsWith("-") && isPlaylistFileName(filename)) {
        const absolute = path.resolve(directory, filename);
        if (!playlistPaths.includes(absolute)) playlistPaths.push(absolute);
      }
    } catch {
      // A malformed file URL is not a path the OS can open.
    }
  }
  void deliverPlaylists();
}

queuePlaylists(process.argv.slice(app.isPackaged ? 1 : 2), process.cwd());

ipcMain.on("earful:playlist-ready", (event) => {
  if (event.sender !== mainWindow?.webContents || event.senderFrame !== event.sender.mainFrame) return;
  if (!event.senderFrame.url.startsWith(`http://127.0.0.1:${server?.port}/`)) return;
  playlistReady = true;
  void deliverPlaylists();
});

async function launch() {
  const splash = createSplash();
  const s = await loadServer();
  // Show progress while yt-dlp and Deno download on the first launch.
  const report = setInterval(() => {
    splash.webContents.executeJavaScript(`window.update(${JSON.stringify(s.downloads(lang))})`).catch(() => {});
  }, 250);

  try {
    await s.refreshTools();
    await s.ensureEssentials();
    server ??= await s.startServer({ port: PORT, host: "127.0.0.1", portFallback: true });
    // FFmpeg is only needed for HD and some videos: fetch it in the background.
    s.ensureComponent("ffmpeg").catch(() => {});
  } catch (err) {
    clearInterval(report);
    const message = JSON.stringify(err instanceof s.HttpError ? s.tr(lang, err.text) : (err as Error).message);
    await splash.webContents.executeJavaScript(`window.fail(${message})`).catch(() => {});
    return;
  }

  clearInterval(report);
  mainWindow = createMainWindow(`http://127.0.0.1:${server.port}`);
  mainWindow.webContents.on("did-start-navigation", (details) => {
    if (details.isMainFrame && !details.isSameDocument) playlistReady = false;
  });
  mainWindow.once("ready-to-show", () => splash.destroy());
}

// What's playing, from the web app: the taskbar buttons follow it (the window title follows the page's title).
let media: MediaState = { playing: false, hasTrack: false };
let thumbarReady = false;
const THUMBAR_LABELS = {
  en: { prev: "Previous", play: "Play", pause: "Pause", next: "Next" },
  "pt-BR": { prev: "Anterior", play: "Tocar", pause: "Pausar", next: "Próxima" },
};
function showThumbar(win: BrowserWindow) {
  if (!thumbarReady || win.isDestroyed() || !win.isVisible()) return;
  const labels = THUMBAR_LABELS[lang as keyof typeof THUMBAR_LABELS] ?? THUMBAR_LABELS.en;
  setThumbar(win, media, labels, (command) => {
    if (!win.isDestroyed()) win.webContents.send("earful:media-command", command);
  });
}
ipcMain.on("earful:media", (event, next: unknown) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win || typeof next !== "object" || !next) return;
  const { playing, hasTrack } = next as Partial<MediaState>;
  const changed = !!playing !== media.playing || !!hasTrack !== media.hasTrack;
  media = { playing: !!playing, hasTrack: !!hasTrack };
  if (changed) showThumbar(win);
});

ipcMain.on("earful:theme", (event, theme: "dark" | "light") => {
  const win = BrowserWindow.fromWebContents(event.sender);
  const colors = THEME[theme] ?? THEME.dark;
  if (!isMac) win?.setTitleBarOverlay({ ...colors, height: TITLEBAR_HEIGHT });
  win?.setBackgroundColor(colors.color);
});

ipcMain.handle("earful:open-path", async (_event, target: unknown) => {
  if (target !== downloadDir) return false;
  try {
    mkdirSync(downloadDir, { recursive: true });
    return (await shell.openPath(downloadDir)) === "";
  } catch {
    return false;
  }
});

ipcMain.on("earful:lang", (_event, next: unknown) => {
  if (!isLang(next) || next === lang) return;
  lang = next;
  try {
    writeFileSync(settingsFile, JSON.stringify({ lang }));
  } catch {
    /* not critical: the splash falls back to English */
  }
});

ipcMain.on("earful:retry", (event) => {
  const failed = BrowserWindow.fromWebContents(event.sender);
  // Open the new splash before closing the old one, or "window-all-closed" would quit the app.
  void launch();
  failed?.destroy();
});

function focusMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.focus();
}

app.on("second-instance", (_event, argv, workingDirectory) => {
  queuePlaylists(argv.slice(app.isPackaged ? 1 : 2), workingDirectory);
  focusMainWindow();
});

app.on("open-file", (event, filename) => {
  event.preventDefault();
  queuePlaylists([filename], process.cwd());
  focusMainWindow();
});

app.on("window-all-closed", () => app.quit());
app.on("before-quit", () => void server?.close());

void app.whenReady().then(() => {
  // macOS needs an app menu: without the Edit menu, Cmd+C/V/A don't reach text fields, and Cmd+Q has no home.
  Menu.setApplicationMenu(
    isMac ? Menu.buildFromTemplate([{ role: "appMenu" }, { role: "editMenu" }, { role: "windowMenu" }]) : null,
  );
  setupUpdater();
  return launch();
});
