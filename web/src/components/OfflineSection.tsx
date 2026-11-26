import { useEffect, useState } from "react";
import { useI18n, useT } from "../i18n";
import { api, cacheDaysOptions, type CacheDays, type CacheStats } from "../lib/api";
import { desktop } from "../lib/desktop";
import { useDownloads } from "../stores/downloads";
import { toast } from "../stores/ui";

const SIZE_UNITS = ["byte", "kilobyte", "megabyte", "gigabyte", "terabyte"];

function formatSize(bytes: number, lang: string) {
  const unit = Math.min(SIZE_UNITS.length - 1, Math.floor(Math.log10(Math.max(1, bytes)) / 3));
  return new Intl.NumberFormat(lang, { style: "unit", unit: SIZE_UNITS[unit], maximumFractionDigits: 1 }).format(bytes / 1000 ** unit);
}

export function OfflineSection() {
  const t = useT();
  const lang = useI18n((s) => s.lang);
  const dir = useDownloads((s) => s.dir);
  const offline = useDownloads((s) => s.offlineTracks);
  const [stats, setStats] = useState<CacheStats>();
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);

  useEffect(() => {
    let current = true;
    api.cacheStats().then((stats) => {
      if (!current) return;
      setStats(stats);
      setFailed(false);
    }, () => { if (current) setFailed(true); });
    return () => { current = false; };
  }, [offline, busy]);

  useEffect(() => { void useDownloads.getState().load(); }, []);

  const change = async (action: () => Promise<CacheStats>) => {
    setBusy(true);
    try {
      setStats(await action());
      void useDownloads.getState().loadOffline();
    } catch {
      toast(t.offline.settingsFailed, "error");
    } finally {
      setBusy(false);
      setConfirm(false);
    }
  };

  return (
    <section className="flex flex-col gap-2">
      <h4 className="text-xs font-medium text-fg-3">{t.offline.section}</h4>
      <div className="flex flex-col gap-3 rounded-[16px] bg-surface-1 p-4 ring-1 ring-line">
        <label className="flex items-center justify-between gap-3 text-sm">
          {t.offline.keep}
          <select
            className="h-10 rounded-xl bg-surface-3 px-3 text-fg"
            value={stats?.days ?? 7}
            disabled={!stats || busy}
            onChange={(e) => {
              const days = Number(e.target.value) as CacheDays;
              void change(() => api.setCacheDays(days));
            }}
          >
            {cacheDaysOptions.map((days) => <option key={days} value={days}>{days ? t.offline.days(days) : t.offline.forever}</option>)}
          </select>
        </label>
        <div className="flex items-center justify-between gap-3 text-sm text-fg-2">
          <p>{stats ? `${t.common.tracks(stats.count)} · ${formatSize(stats.bytes, lang)}` : failed ? t.offline.statsFailed : t.settings.checking}</p>
          {!confirm && (
            <button type="button" disabled={!stats || busy} onClick={() => setConfirm(true)} className="h-11 shrink-0 rounded-full bg-surface-3 px-4 text-fg hover:bg-surface-4 disabled:opacity-50">
              {t.offline.clear}
            </button>
          )}
        </div>
        {confirm && (
          <div className="flex flex-wrap items-center justify-end gap-2 text-sm">
            <p className="mr-auto text-fg-2">{t.offline.clearConfirm}</p>
            <button type="button" disabled={busy} onClick={() => setConfirm(false)} className="h-11 rounded-full px-4 hover:bg-surface-3">{t.common.cancel}</button>
            <button type="button" disabled={busy} onClick={() => void change(api.clearCache)} className="h-11 rounded-full bg-danger px-4 text-white">{t.offline.clear}</button>
          </div>
        )}
        <div className="flex items-center justify-between gap-3 border-t border-line pt-3">
          <div className="min-w-0">
            <p className="text-sm font-medium">{t.offline.downloads}</p>
            {dir && <p className="mt-1 text-xs break-all text-fg-2">{dir}</p>}
          </div>
          {dir && desktop?.openPath && (
            <button type="button" className="h-11 shrink-0 rounded-full bg-surface-3 px-4 text-sm hover:bg-surface-4" onClick={async () => {
              const opened = await desktop?.openPath?.(dir).catch(() => false);
              if (!opened) toast(t.offline.folderFailed, "error");
            }}>
              {t.offline.folder}
            </button>
          )}
        </div>
      </div>
    </section>
  );
}
