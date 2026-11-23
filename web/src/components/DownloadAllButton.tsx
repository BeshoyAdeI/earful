import { DownloadSimpleIcon } from "@phosphor-icons/react";
import { useT } from "../i18n";
import type { Track } from "../lib/types";
import { useDownloads } from "../stores/downloads";
import { IconButton } from "./IconButton";

export function DownloadAllButton({ tracks }: { tracks: Track[] }) {
  const t = useT();
  return (
    <IconButton
      label={t.offline.downloadAll}
      size="lg"
      disabled={!tracks.length}
      onClick={() => void useDownloads.getState().download(tracks)}
    >
      <DownloadSimpleIcon size={24} />
    </IconButton>
  );
}
