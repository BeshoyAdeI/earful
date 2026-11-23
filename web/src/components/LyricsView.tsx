import { useReducedMotion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { useT } from "../i18n";
import { cn } from "../lib/format";
import type { LyricLine, Track } from "../lib/types";
import { usePlayer } from "../player/player";
import { useLyrics } from "../stores/lyrics";

function activeLine(lines: LyricLine[], position: number): number {
  let low = 0;
  let high = lines.length;
  while (low < high) {
    const mid = (low + high) >>> 1;
    if (lines[mid].time <= position) low = mid + 1;
    else high = mid;
  }
  return low - 1;
}

function SyncedLyrics({ lines }: { lines: LyricLine[] }) {
  const t = useT();
  const active = usePlayer((s) => activeLine(lines, s.position));
  const scroll = useRef<HTMLDivElement>(null);
  const line = useRef<HTMLLIElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [paused, setPaused] = useState(false);
  const reduce = useReducedMotion();

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const pause = () => {
    const container = scroll.current;
    if (!paused && container) container.scrollTo({ top: container.scrollTop, behavior: "instant" });
    setPaused(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setPaused(false), 4_000);
  };

  useEffect(() => {
    const container = scroll.current;
    const current = line.current;
    if (!container || paused) return;
    const top = current
      ? container.scrollTop + current.getBoundingClientRect().top - container.getBoundingClientRect().top - container.clientHeight / 3
      : 0;
    container.scrollTo({ top, behavior: reduce ? "instant" : "smooth" });
  }, [active, paused, reduce]);

  return (
    <div
      ref={scroll}
      tabIndex={0}
      aria-label={t.lyrics.title}
      onWheel={pause}
      onTouchMove={pause}
      onScroll={() => { if (paused) pause(); }}
      onPointerDown={(event) => { if (event.target === event.currentTarget) pause(); }}
      onKeyDown={(event) => {
        if (["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End"].includes(event.key)) pause();
      }}
      className="scroll-area min-h-0 flex-1 touch-pan-y overflow-y-auto overscroll-contain [container-type:size]"
    >
      <ol className="flex min-h-full flex-col gap-3 px-2 pt-4 pb-[66cqh]">
        {lines.map(({ time, text }, i) => (
          <li key={i} ref={active === i ? line : undefined} aria-current={active === i ? "true" : undefined}>
            {text && (
              <button
                type="button"
                onClick={() => usePlayer.getState().seek(time)}
                className={cn(
                  "cursor-pointer text-left leading-snug hover:underline",
                  active === i ? "text-xl font-bold text-fg" : i < active ? "text-base text-fg-3" : "text-base text-fg-2",
                )}
              >
                {text}
              </button>
            )}
          </li>
        ))}
      </ol>
    </div>
  );
}

export function LyricsView({ track }: { track: Track }) {
  const t = useT();
  const result = useLyrics((s) => s.id === track.id ? s.result : null);
  const load = useLyrics((s) => s.load);
  useEffect(() => { void load(track); }, [track, load]);

  if (!result || result.status === "loading") {
    return (
      <div role="status" aria-label={t.lyrics.loading} className="flex flex-col gap-4 px-3 py-6">
        {[75, 56, 85, 62, 74].map((width, i) => (
          <span key={i} className="skeleton h-4 rounded-full" style={{ width: `${width}%` }} />
        ))}
      </div>
    );
  }
  if (result.status === "error") {
    return (
      <div role="status" className="flex flex-col items-center gap-3 px-3 py-10 text-center text-sm text-fg-2">
        <p>{t.lyrics.error}</p>
        <button type="button" className="rounded-full bg-surface-3 px-4 py-2 text-fg" onClick={() => void load(track, true)}>
          {t.common.retry}
        </button>
      </div>
    );
  }
  const { lyrics } = result;
  if (!lyrics) return <p role="status" className="px-3 py-10 text-center text-sm text-fg-2">{t.lyrics.empty}</p>;

  return (
    <div className="flex h-full min-h-0 flex-col">
      {lyrics.instrumental ? (
        <p className="flex-1 px-3 py-10 text-center text-sm text-fg-2">{t.lyrics.instrumental}</p>
      ) : lyrics.synced ? (
        <SyncedLyrics key={track.id} lines={lyrics.synced} />
      ) : (
        <div tabIndex={0} aria-label={t.lyrics.title} className="scroll-area min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 py-4">
          <p className="text-base leading-relaxed whitespace-pre-wrap">{lyrics.plain}</p>
        </div>
      )}
      <p className="shrink-0 px-2 py-2 text-xs text-fg-3">{t.lyrics[lyrics.source]}</p>
    </div>
  );
}
