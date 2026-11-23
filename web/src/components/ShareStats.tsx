import { DownloadSimpleIcon, ShareNetworkIcon } from "@phosphor-icons/react";
import { useEffect, useState } from "react";
import { useI18n, useT } from "../i18n";
import { api, type Stats } from "../lib/api";
import { DAY_MS, dayKey } from "../lib/profileStats";
import { renderStatsImage, type ShareFormat } from "../lib/statsImage";
import { useAppearance } from "../stores/appearance";
import type { ProfileRange } from "../stores/profile";
import { toast, useUi } from "../stores/ui";
import { Modal } from "./Modal";
import { ProfileSegments } from "./ProfileSegments";

const formats = ["story", "square"] as const;
const button = "inline-flex min-h-10 flex-1 items-center justify-center gap-2 rounded-full px-3 text-sm font-semibold disabled:opacity-50";

export function ShareStats({ stats, name, range, onClose }: { stats: Stats; name: string; range: ProfileRange; onClose: () => void }) {
  const t = useT();
  const p = t.profile;
  const lang = useI18n((s) => s.lang);
  const accent = useAppearance((s) => s.accent);
  const theme = useUi((s) => s.theme);
  const [format, setFormat] = useState<ShareFormat>("story");
  const [preview, setPreview] = useState<{ blob: Blob; url: string }>();
  const [canShare, setCanShare] = useState(false);
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [date] = useState(() => dayKey(Math.floor((Date.now() - new Date().getTimezoneOffset() * 60_000) / DAY_MS)));
  const filename = `earful-stats-${range}-${date}.png`;
  const rangeLabel = p[range];

  useEffect(() => {
    let active = true;
    let url: string | undefined;
    setPreview(undefined);
    setCanShare(false);
    setFailed(false);
    void renderStatsImage(stats, { format, name, rangeLabel, accent, theme, lang }).then((blob) => {
      if (!active) return;
      url = URL.createObjectURL(blob);
      setPreview({ blob, url });
      void api.canShareImage(filename, blob).then((canShare) => {
        if (active) setCanShare(canShare);
      }).catch(() => {});
    }).catch(() => {
      if (active) setFailed(true);
    });
    return () => {
      active = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [stats, format, name, rangeLabel, accent, theme, lang, filename]);

  const send = async (share: boolean) => {
    if (!preview || busy) return;
    setBusy(true);
    try {
      if (share) await api.shareImage(filename, preview.blob, p.shareText(name, rangeLabel));
      else await api.saveImage(filename, preview.blob);
    } catch (error) {
      if ((error as Error).name !== "AbortError") toast(share ? p.shareError : p.saveError, "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open title={p.shareTitle} onClose={onClose}>
      <div className="scroll-area flex max-h-[70dvh] flex-col gap-4 overflow-y-auto p-1">
        <ProfileSegments label={p.format} labels={p} options={formats} value={format} onChange={setFormat} />
        <div className="grid min-h-32 place-items-center rounded-xl bg-bg p-2">
          {preview ? (
            <img src={preview.url} alt={p.preview} className="max-h-[46dvh] max-w-full rounded-lg object-contain" />
          ) : <p role="status" className="text-sm text-fg-2">{failed ? p.imageError : p.rendering}</p>}
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" disabled={!preview || busy} className={`${button} bg-surface-3 text-fg hover:bg-surface-4`}
            onClick={() => void send(false)}>
            <DownloadSimpleIcon size={18} />{p.save}
          </button>
          {canShare && (
            <button type="button" disabled={busy} className={`${button} bg-accent text-accent-ink`} onClick={() => void send(true)}>
              <ShareNetworkIcon size={18} />{p.share}
            </button>
          )}
        </div>
      </div>
    </Modal>
  );
}
