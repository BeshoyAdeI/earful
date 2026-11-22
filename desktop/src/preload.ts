import { contextBridge, ipcRenderer } from "electron";

// The only bridge between the web app and the desktop shell.
contextBridge.exposeInMainWorld("earfulDesktop", {
  platform: process.platform,
  setTheme: (theme: "dark" | "light") => ipcRenderer.send("earful:theme", theme),
  setLanguage: (lang: string) => ipcRenderer.send("earful:lang", lang),
  retry: () => ipcRenderer.send("earful:retry"),
});
