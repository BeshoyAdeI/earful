/** What the desktop app's updater is doing (desktop/src/updater.mts). */
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
      total: number;
      fullSize?: number;
    }
  | { status: "downloaded"; current: string; version: string; notes: string }
  | { status: "error"; current: string; message: string; version?: string };

interface UpdateBridge {
  get: () => Promise<UpdateState>;
  check: () => Promise<UpdateState>;
  download: () => Promise<UpdateState>;
  install: () => Promise<UpdateState>;
  openRelease: () => Promise<void>;
  onState: (handler: (state: UpdateState) => void) => () => void;
}

/** Bridge exposed by the Electron preload script when Earful runs as the desktop app. */
interface DesktopBridge {
  platform: string;
  setTheme: (theme: "dark" | "light") => void;
  /** Missing in desktop builds older than 1.2. */
  setLanguage?: (lang: string) => void;
  openPath?: (path: string) => Promise<boolean>;
  /** Missing in desktop builds older than 1.6.1. */
  update?: UpdateBridge;
  onOpenPlaylist?: (handler: (file: { text?: string; fileName: string; error?: "tooLarge" | "readFailed" }) => void) => () => void;
}

export const desktop = (window as Window & { earfulDesktop?: DesktopBridge }).earfulDesktop;

if (desktop) {
  document.documentElement.dataset.desktop = "true";
  // Match the native window buttons to the theme picked before this script ran.
  desktop.setTheme(document.documentElement.dataset.theme === "light" ? "light" : "dark");
}
