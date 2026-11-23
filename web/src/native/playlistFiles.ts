import { App } from "@capacitor/app";
import { Encoding, Filesystem } from "@capacitor/filesystem";
import { getT } from "../i18n";
import type { ExternalFileHandler } from "../lib/apiTypes";
import { isPlaylistFileName, MAX_PLAYLIST_FILE_BYTES } from "../lib/playlistFile";
import { toast } from "../stores/ui";

export function onExternalFile(handler: ExternalFileHandler): () => void {
  let active = true;
  const duringLaunch = new Set<string>();
  let checkingLaunch = true;

  const open = async (url: string) => {
    if (!active || !/^(content|file):\/\//i.test(url)) return;
    try {
      const name = decodeURIComponent(new URL(url).pathname.split("/").pop() ?? "");
      // Android providers may give the document an opaque content URI.
      if (url.startsWith("file:") && !isPlaylistFileName(name)) return;
      const info = await Filesystem.stat({ path: url }).catch(() => undefined);
      if (!active) return;
      if (info && info.size > MAX_PLAYLIST_FILE_BYTES) return toast(getT().playlistFile.tooLarge, "error");
      const { data } = await Filesystem.readFile({ path: url, encoding: Encoding.UTF8 });
      if (active && typeof data === "string") handler(data, isPlaylistFileName(name) ? name : undefined);
    } catch {
      if (active) toast(getT().playlistFile.readFailed, "error");
    }
  };

  const listener = Promise.resolve().then(async () => {
    if (!active) return;
    const handle = await App.addListener("appUrlOpen", ({ url }) => {
      if (!active) return;
      if (checkingLaunch) duringLaunch.add(url);
      void open(url);
    });
    if (active) {
      const launch = await App.getLaunchUrl().catch(() => undefined);
      checkingLaunch = false;
      if (launch?.url && !duringLaunch.has(launch.url)) void open(launch.url);
      duringLaunch.clear();
    }
    return handle;
  }).catch(() => undefined);

  return () => {
    active = false;
    void listener.then((handle) => handle?.remove()).catch(() => {});
  };
}
