import { contextBridge, ipcRenderer } from "electron";

// The only bridge between the web app and the desktop shell.
contextBridge.exposeInMainWorld("earfulDesktop", {
  platform: process.platform,
  setTheme: (theme: "dark" | "light") => ipcRenderer.send("earful:theme", theme),
  setLanguage: (lang: string) => ipcRenderer.send("earful:lang", lang),
  retry: () => ipcRenderer.send("earful:retry"),
  openPath: (path: string): Promise<boolean> => ipcRenderer.invoke("earful:open-path", path),
  update: {
    get: () => ipcRenderer.invoke("earful:update-get"),
    check: () => ipcRenderer.invoke("earful:update-check"),
    download: () => ipcRenderer.invoke("earful:update-download"),
    install: () => ipcRenderer.invoke("earful:update-install"),
    openRelease: () => ipcRenderer.invoke("earful:update-open-release"),
    onState: (handler: (state: unknown) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, state: unknown) => handler(state);
      ipcRenderer.on("earful:update-state", listener);
      return () => ipcRenderer.removeListener("earful:update-state", listener);
    },
  },
  /** What's playing, for the Windows taskbar buttons. */
  setMedia: (state: { playing: boolean; hasTrack: boolean }) => ipcRenderer.send("earful:media", state),
  onMediaCommand: (handler: (command: string) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, command: string) => handler(command);
    ipcRenderer.on("earful:media-command", listener);
    return () => ipcRenderer.removeListener("earful:media-command", listener);
  },
  onOpenPlaylist: (handler: (file: unknown) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, file: unknown) => handler(file);
    ipcRenderer.on("earful:open-playlist", listener);
    ipcRenderer.send("earful:playlist-ready");
    return () => ipcRenderer.removeListener("earful:open-playlist", listener);
  },
});
