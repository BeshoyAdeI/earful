import { contextBridge, ipcRenderer } from "electron";

// The only bridge between the web app and the desktop shell.
contextBridge.exposeInMainWorld("earfulDesktop", {
  platform: process.platform,
  setTheme: (theme: "dark" | "light") => ipcRenderer.send("earful:theme", theme),
  setLanguage: (lang: string) => ipcRenderer.send("earful:lang", lang),
  retry: () => ipcRenderer.send("earful:retry"),
  openPath: (path: string): Promise<boolean> => ipcRenderer.invoke("earful:open-path", path),
  onOpenPlaylist: (handler: (file: unknown) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, file: unknown) => handler(file);
    ipcRenderer.on("earful:open-playlist", listener);
    ipcRenderer.send("earful:playlist-ready");
    return () => ipcRenderer.removeListener("earful:open-playlist", listener);
  },
});
