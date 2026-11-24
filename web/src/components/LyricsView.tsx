import { ArrowsOutSimpleIcon } from "@phosphor-icons/react";
import { useReducedMotion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { useT } from "../i18n";
import { cn } from "../lib/format";
import type { LyricLine, Track } from "../lib/types";
import { usePlayer } from "../player/player";
import { useLyrics } from "../stores/lyrics";
import { useUi } from "../stores/ui";

type Size = "panel" | "stage";

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

const easeOutCubic = (x: number) => 1 - (1 - x) ** 3;

/**
 * Glides a scroll container to `top`: an eased animation instead of the browser's quick smooth scroll, so the
 * lyrics drift to the next line the way the line itself fades in. Returns a function that cancels it.
 */
function glide(container: HTMLElement, top: number, ms: number): () => void {
  const from = container.scrollTop;
  const distance = top - from;
  if (Math.abs(distance) < 1) return () => {};
  let frame = 0;
  const started = performance.now();
  const step = (now: number) => {
    const t = Math.min(1, (now - started) / ms);
    container.scrollTop = from + distance * easeOutCubic(t);
    if (t < 1) frame = requestAnimationFrame(step);
  };
  frame = requestAnimationFrame(step);
  return () => cancelAnimationFrame(frame);
}

/**
 * Synced lyrics that follow the song. On the stage they can be scrolled and a line seeks to it. In the panel they
 * can't be scrolled (so swiping over them moves the page or player around them) and a tap opens the stage.
 */
function SyncedLyrics({ lines, size, onOpen }: { lines: LyricLine[]; size: Size; onOpen: () => void }) {
  const t = useT();
  const active = usePlayer((s) => activeLine(lines, s.position));
  const scroll = useRef<HTMLDivElement>(null);
  const line = useRef<HTMLLIElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancel = useRef<() => void>(() => {});
  const gliding = useRef(false);
  const [paused, setPaused] = useState(false);
  const reduce = useReducedMotion();
  const stage = size === "stage";

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
    cancel.current();
  }, []);

  /** The person scrolled: stop following the song for a few seconds. */
  const pause = () => {
    cancel.current();
    gliding.current = false;
    setPaused(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setPaused(false), 4_000);
  };

  useEffect(() => {
    const container = scroll.current;
    const current = line.current;
    if (!container || paused) return;
    // The active line sits a third of the way down in the panel, in the middle on the stage.
    const anchor = stage ? container.clientHeight / 2 - (current?.offsetHeight ?? 0) / 2 : container.clientHeight / 3;
    const top = current
      ? container.scrollTop + current.getBoundingClientRect().top - container.getBoundingClientRect().top - anchor
      : 0;
    cancel.current();
    if (reduce) {
      container.scrollTop = top;
      return;
    }
    gliding.current = true;
    cancel.current = glide(container, top, 700);
    const done = setTimeout(() => (gliding.current = false), 720);
    return () => clearTimeout(done);
  }, [active, paused, reduce, stage]);

  if (!stage) {
    return (
      <div
        ref={scroll}
        role="button"
        tabIndex={0}
        aria-label={t.lyrics.expand}
        title={t.lyrics.expand}
        onClick={onOpen}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            onOpen();
          }
        }}
        className="min-h-0 flex-1 cursor-pointer overflow-hidden [container-type:size] [mask-image:linear-gradient(to_bottom,transparent,black_12%,black_80%,transparent)]"
      >
        <ol aria-hidden="true" className="flex min-h-full flex-col gap-3 px-2 pt-4 pb-[66cqh]">
          {lines.map(({ text }, i) => (
            <li key={i} ref={active === i ? line : undefined}>
              {text && (
                <span
                  className={cn(
                    "inline-block origin-left text-xl leading-snug font-bold text-fg transition-[opacity,transform] duration-500 ease-out motion-reduce:transition-none",
                    active === i ? "scale-100 opacity-100" : cn("scale-[0.97]", i < active ? "opacity-35" : "opacity-55"),
                  )}
                >
                  {text}
                </span>
              )}
            </li>
          ))}
        </ol>
      </div>
    );
  }

  return (
    <div
      ref={scroll}
      tabIndex={0}
      aria-label={t.lyrics.title}
      onWheel={pause}
      onTouchMove={pause}
      // Only scrolling the person did counts: the glide above scrolls too.
      onScroll={() => { if (paused && !gliding.current) pause(); }}
      onPointerDown={(event) => { if (event.target === event.currentTarget) pause(); }}
      onKeyDown={(event) => {
        if (["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End"].includes(event.key)) pause();
      }}
      className="scroll-area min-h-0 flex-1 touch-pan-y overflow-y-auto overscroll-contain [container-type:size]"
    >
      <ol className={cn("flex min-h-full flex-col", stage ? "gap-6 px-4 py-[50cqh] text-center" : "gap-3 px-2 pt-4 pb-[66cqh]")}>
        {lines.map(({ time, text }, i) => (
          <li key={i} ref={active === i ? line : undefined} aria-current={active === i ? "true" : undefined}>
            {text && (
              <button
                type="button"
                onClick={() => usePlayer.getState().seek(time)}
                className={cn(
                  // Every line keeps its size: only color, opacity and a slight scale change, so nothing jumps.
                  "cursor-pointer leading-snug font-bold transition-[color,opacity,transform,filter] duration-500 ease-out",
                  "motion-reduce:transition-none hover:opacity-100",
                  stage ? "origin-center text-3xl md:text-4xl" : "origin-left text-left text-xl",
                  active === i
                    ? "scale-100 text-fg opacity-100"
                    : cn("scale-[0.97] text-fg", i < active ? "opacity-35" : "opacity-55", stage && "blur-[0.5px]"),
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

export function LyricsView({ track, size = "panel" }: { track: Track; size?: Size }) {
  const t = useT();
  const result = useLyrics((s) => s.id === track.id ? s.result : null);
  const load = useLyrics((s) => s.load);
  const setStage = useUi((s) => s.setLyricsStage);
  useEffect(() => { void load(track); }, [track, load]);
  const stage = size === "stage";

  if (!result || result.status === "loading") {
    return (
      <div role="status" aria-label={t.lyrics.loading} className={cn("flex flex-col gap-4 px-3 py-6", stage && "items-center")}>
        {[75, 56, 85, 62, 74].map((width, i) => (
          <span key={i} className={cn("skeleton rounded-full", stage ? "h-7" : "h-4")} style={{ width: `${width}%` }} />
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
        <SyncedLyrics key={track.id} lines={lyrics.synced} size={size} onOpen={() => setStage(true)} />
      ) : !stage ? (
        // Plain lyrics don't follow the song: the panel shows the start, a tap opens all of them.
        <button
          type="button"
          onClick={() => setStage(true)}
          aria-label={t.lyrics.expand}
          title={t.lyrics.expand}
          className="min-h-0 flex-1 overflow-hidden px-2 py-4 text-left [mask-image:linear-gradient(to_bottom,black_75%,transparent)]"
        >
          <p className="text-base leading-relaxed whitespace-pre-wrap">{lyrics.plain}</p>
        </button>
      ) : (
        <div tabIndex={0} aria-label={t.lyrics.title} className="scroll-area min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 py-4">
          <p className={cn("leading-relaxed whitespace-pre-wrap", stage ? "text-center text-2xl font-semibold md:text-3xl" : "text-base")}>
            {lyrics.plain}
          </p>
        </div>
      )}
      <div className={cn("flex shrink-0 items-center gap-2 px-2 py-2", stage && "justify-center")}>
        <p className={cn("min-w-0 flex-1 truncate text-xs text-fg-3", stage && "text-center")}>{t.lyrics[lyrics.source]}</p>
        {!stage && !lyrics.instrumental && (
          <button
            type="button"
            onClick={() => setStage(true)}
            aria-label={t.lyrics.expand}
            title={t.lyrics.expand}
            className="grid size-8 shrink-0 place-items-center rounded-full text-fg-2 hover:bg-surface-3 hover:text-fg"
          >
            <ArrowsOutSimpleIcon size={16} />
          </button>
        )}
      </div>
    </div>
  );
}
