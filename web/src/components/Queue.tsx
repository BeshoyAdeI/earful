import { DotsSixVerticalIcon, DotsThreeIcon, QueueIcon, XIcon } from "@phosphor-icons/react";
import { useRef, useState, type MouseEvent, type PointerEvent } from "react";
import { useT } from "../i18n";
import { cn, formatTime } from "../lib/format";
import type { Track } from "../lib/types";
import { usePlayer } from "../player/player";
import { useUi } from "../stores/ui";
import { ArtistLinks } from "./ArtistLinks";
import { Artwork } from "./Artwork";
import { Equalizer } from "./Brand";

export function QueueList({ compact = false, onArtistNavigate }: { compact?: boolean; onArtistNavigate?: () => void }) {
  const t = useT();
  const queue = usePlayer((s) => s.queue);
  const index = usePlayer((s) => s.index);
  const live = usePlayer((s) => s.status === "playing" || s.status === "loading");
  const jumpTo = usePlayer((s) => s.jumpTo);
  const removeAt = usePlayer((s) => s.removeAt);
  const clearUpcoming = usePlayer((s) => s.clearUpcoming);
  const autoRadio = usePlayer((s) => s.autoRadio);
  const setAutoRadio = usePlayer((s) => s.setAutoRadio);
  const moveTo = usePlayer((s) => s.moveTo);
  const openMenu = useUi((s) => s.openMenu);

  // Dragging an upcoming song by its handle: where it started, how far it moved, and the height of a row.
  const [drag, setDrag] = useState<{ from: number; startY: number; dy: number; row: number } | null>(null);
  const list = useRef<HTMLUListElement>(null);

  const current = queue[index];
  const upcoming = queue.slice(index + 1);
  const first = index + 1;
  const last = queue.length - 1;
  const dropAt = drag ? Math.min(last, Math.max(first, drag.from + Math.round(drag.dy / drag.row))) : -1;

  const startDrag = (i: number) => (e: PointerEvent<HTMLButtonElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    const row = e.currentTarget.closest("li")?.offsetHeight || 52;
    setDrag({ from: i, startY: e.clientY, dy: 0, row });
  };
  const moveDrag = (e: PointerEvent<HTMLButtonElement>) => {
    if (drag) setDrag({ ...drag, dy: e.clientY - drag.startY });
  };
  const endDrag = () => {
    if (drag && dropAt !== drag.from) moveTo(drag.from, dropAt);
    setDrag(null);
  };

  /** How far a row slides while another one is dragged past it. */
  const shiftFor = (i: number) => {
    if (!drag) return 0;
    if (i === drag.from) return drag.dy;
    if (drag.from < i && i <= dropAt) return -drag.row;
    if (dropAt <= i && i < drag.from) return drag.row;
    return 0;
  };

  const menuAt = (track: Track, i: number) => (e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const fromButton = e.type === "click";
    openMenu({ track, queueIndex: i, x: fromButton ? r.right - 256 : e.clientX, y: fromButton ? r.bottom + 6 : e.clientY });
  };

  if (!current) {
    return (
      <div className="flex flex-col items-center gap-3 px-6 py-16 text-center">
        <span className="grid size-14 place-items-center rounded-[14px] bg-surface-3 text-fg-3">
          <QueueIcon size={26} />
        </span>
        <p className="font-medium">{t.queue.emptyTitle}</p>
        <p className="max-w-[28ch] text-sm text-fg-2">{t.queue.emptyBody}</p>
      </div>
    );
  }

  const row = (i: number, isCurrent: boolean) => {
    const track = queue[i];
    return (
      <li
        key={`${track.id}-${i}`}
        onContextMenu={menuAt(track, i)}
        style={{ transform: `translateY(${shiftFor(i)}px)` }}
        className={cn(
          "group relative flex items-center gap-3 rounded-xl px-2 py-1.5 hover:bg-surface-3",
          drag?.from === i ? "z-20 bg-surface-3 shadow-[0_8px_24px_rgb(0_0_0/0.35)]" : drag && "transition-transform duration-150 ease-out",
        )}
      >
        <button type="button" onClick={() => jumpTo(i)} className="absolute inset-0 rounded-xl" aria-label={t.common.playX(track.title)} />
        {!isCurrent && (
          <button
            type="button"
            onPointerDown={startDrag(i)}
            onPointerMove={moveDrag}
            onPointerUp={endDrag}
            onPointerCancel={() => setDrag(null)}
            onKeyDown={(e) => {
              if (e.key === "ArrowUp" && i > first) moveTo(i, i - 1);
              else if (e.key === "ArrowDown" && i < last) moveTo(i, i + 1);
              else return;
              e.preventDefault();
            }}
            aria-label={t.queue.reorder(track.title)}
            title={t.queue.reorderHint}
            className="relative z-10 -mr-2 -ml-1 grid h-10 w-6 shrink-0 cursor-grab touch-none place-items-center text-fg-3 hover:text-fg active:cursor-grabbing"
          >
            <DotsSixVerticalIcon size={16} weight="bold" />
          </button>
        )}
        <Artwork src={track.thumb} className="pointer-events-none size-10 rounded-[8px]" />
        <div className="pointer-events-none min-w-0 flex-1">
          <p className={cn("truncate text-sm font-medium", isCurrent ? "text-accent-text" : "text-fg")}>{track.title}</p>
          <p className="truncate text-xs text-fg-2"><ArtistLinks track={track} onNavigate={onArtistNavigate} /></p>
        </div>
        {isCurrent ? (
          <Equalizer live={live} className="mr-2" />
        ) : (
          <>
            <span className="pointer-events-none font-mono text-xs text-fg-3 tabular-nums group-hover:hidden">
              {track.duration ? formatTime(track.duration) : ""}
            </span>
            <button
              type="button"
              onClick={() => removeAt(i)}
              aria-label={t.queue.removeX(track.title)}
              title={t.queue.remove}
              className="relative z-10 hidden size-8 place-items-center rounded-full text-fg-2 hover:bg-surface-4 hover:text-fg group-hover:grid max-md:grid"
            >
              <XIcon size={16} />
            </button>
          </>
        )}
        <button
          type="button"
          onClick={menuAt(track, i)}
          aria-label={t.trackList.moreFor(track.title)}
          title={t.trackList.more}
          className="relative z-10 grid size-8 shrink-0 place-items-center rounded-full text-fg-2 hover:bg-surface-4 hover:text-fg md:hidden md:group-hover:grid"
        >
          <DotsThreeIcon size={20} weight="bold" />
        </button>
      </li>
    );
  };

  return (
    <div className={cn("flex flex-col gap-4", compact ? "" : "pb-4")}>
      <section>
        <h3 className="px-2 pb-1.5 text-xs font-medium text-fg-3">{t.queue.nowPlaying}</h3>
        <ul>{row(index, true)}</ul>
      </section>

      <section>
        <div className="flex items-center justify-between px-2 pb-1.5">
          <h3 className="text-xs font-medium text-fg-3">
            {t.queue.upNext} <span className="font-mono">{upcoming.length}</span>
          </h3>
          {upcoming.length > 0 && (
            <button type="button" onClick={clearUpcoming} className="text-xs font-medium text-fg-2 hover:text-fg">
              {t.queue.clear}
            </button>
          )}
        </div>
        {upcoming.length ? (
          <ul ref={list} className={cn(drag && "select-none")}>{upcoming.map((_, k) => row(index + 1 + k, false))}</ul>
        ) : (
          <p className="px-2 text-sm text-fg-2">
            {t.queue.nothingQueued} {autoRadio ? t.queue.radioContinues : ""}
          </p>
        )}
      </section>

      <label className="mx-2 flex cursor-pointer items-center justify-between gap-3 rounded-xl bg-surface-1 px-3 py-2.5 ring-1 ring-line">
        <span>
          <span className="block text-sm font-medium">{t.queue.autoRadio}</span>
          <span className="block text-xs text-fg-2">{t.queue.autoRadioBody}</span>
        </span>
        <input
          type="checkbox"
          checked={autoRadio}
          onChange={(e) => setAutoRadio(e.target.checked)}
          className="peer sr-only"
        />
        <span
          aria-hidden="true"
          className={cn(
            "relative h-6 w-10 shrink-0 rounded-full transition-colors duration-200 peer-focus-visible:outline-2 peer-focus-visible:outline-accent",
            autoRadio ? "bg-accent" : "bg-surface-4",
          )}
        >
          <span
            className={cn(
              "absolute top-1 left-1 size-4 rounded-full transition-transform duration-200 ease-out-expo",
              autoRadio ? "translate-x-4 bg-accent-ink" : "bg-fg-2",
            )}
          />
        </span>
      </label>
    </div>
  );
}
