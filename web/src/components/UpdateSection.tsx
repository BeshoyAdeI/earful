import { ArrowClockwiseIcon, ArrowSquareOutIcon, CaretDownIcon, DownloadSimpleIcon, RocketLaunchIcon } from "@phosphor-icons/react";
import { useState } from "react";
import { useT } from "../i18n";
import { cn } from "../lib/format";
import { updatesInApp, useAppUpdate } from "../stores/appUpdate";

const mb = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} MB`;

/** Settings → Updates: the current version, and the next one when GitHub has it. */
export function UpdateSection() {
  const t = useT();
  const { state, check, download, install, openRelease } = useAppUpdate();
  const [showNotes, setShowNotes] = useState(false);
  if (state.status === "unsupported") return null;

  const action = "flex h-11 items-center justify-center gap-2 rounded-full px-5 text-sm font-semibold transition-transform active:scale-[0.97] disabled:opacity-50";
  const notes = "notes" in state ? state.notes : "";
  const version = "version" in state ? state.version : undefined;

  return (
    <section className="flex flex-col gap-3">
      <h3 className="text-xs font-medium text-fg-3">{t.update.title}</h3>
      <div className="flex flex-col gap-3 rounded-[16px] bg-surface-1 p-4 ring-1 ring-line">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="font-semibold tracking-tight">
              {version && state.status !== "error" ? t.update.newVersion(version) : t.update.current(state.current)}
            </p>
            <p className="text-[13px] text-fg-2" role="status" aria-live="polite">
              {state.status === "checking" && t.update.checking}
              {state.status === "latest" && t.update.latest}
              {state.status === "idle" && t.update.idle}
              {state.status === "available" && (state.canInstall ? (updatesInApp ? t.update.readyFull(state.current) : t.update.ready(state.current)) : t.update.manual(state.current))}
              {state.status === "downloading" &&
                (state.total
                  ? t.update.downloading(mb(state.transferred), mb(state.total))
                  : t.update.starting)}
              {state.status === "downloaded" && (updatesInApp ? t.update.installReady : t.update.downloaded)}
              {state.status === "error" && t.update.failed(state.message)}
            </p>
            {state.status === "downloading" && state.fullSize && (
              <p className="text-[12px] text-accent-text">{t.update.saved(mb(state.total), mb(state.fullSize))}</p>
            )}
          </div>
          {(state.status === "available" || state.status === "downloaded") && (
            <span className="shrink-0 rounded-full bg-accent-soft px-2.5 py-1 text-xs font-medium text-accent-text">{t.update.chip}</span>
          )}
        </div>

        {state.status === "downloading" && (
          <div className="h-1.5 overflow-hidden rounded-full bg-surface-3">
            <div className="h-full rounded-full bg-accent transition-[width]" style={{ width: `${state.percent}%` }} />
          </div>
        )}

        {notes && (
          <div>
            <button
              type="button"
              onClick={() => setShowNotes((o) => !o)}
              aria-expanded={showNotes}
              className="flex items-center gap-1.5 text-sm text-fg-2 hover:text-fg"
            >
              {t.update.notes}
              <CaretDownIcon size={12} className={cn("transition-transform", showNotes && "rotate-180")} />
            </button>
            {showNotes && (
              <p className="scroll-area mt-2 max-h-48 overflow-y-auto rounded-[12px] bg-surface-2 p-3 text-[13px] whitespace-pre-wrap text-fg-2">
                {notes}
              </p>
            )}
          </div>
        )}

        <div className="flex flex-wrap justify-end gap-2">
          {(state.status === "available" || state.status === "downloaded" || state.status === "error") && (
            <button type="button" onClick={openRelease} className="flex h-11 items-center gap-2 rounded-full px-4 text-sm font-medium text-fg-2 hover:text-fg">
              <ArrowSquareOutIcon size={16} /> {t.update.whatsNew}
            </button>
          )}
          {(state.status === "idle" || state.status === "latest" || state.status === "checking" || (state.status === "error" && !version)) && (
            <button
              type="button"
              onClick={() => void check()}
              disabled={state.status === "checking"}
              className={cn(action, "bg-surface-3 font-medium hover:bg-surface-4")}
            >
              <ArrowClockwiseIcon size={16} /> {t.update.check}
            </button>
          )}
          {(state.status === "available" || (state.status === "error" && version)) && (
            <button type="button" onClick={() => void download()} className={cn(action, "bg-accent text-accent-ink")}>
              <DownloadSimpleIcon size={16} />
              {state.status === "available" && !state.canInstall ? t.update.get : t.update.download}
            </button>
          )}
          {state.status === "downloaded" && (
            <button type="button" onClick={() => void install()} className={cn(action, "bg-accent text-accent-ink")}>
              <RocketLaunchIcon size={16} /> {updatesInApp ? t.update.install : t.update.restart}
            </button>
          )}
        </div>
      </div>
    </section>
  );
}
