import { XIcon } from "@phosphor-icons/react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect } from "react";
import { useT } from "../i18n";
import { usePlayer } from "../player/player";
import { useUi } from "../stores/ui";
import { ArtistLinks } from "./ArtistLinks";
import { LyricsView } from "./LyricsView";

/** Lyrics in the middle of the screen, big, over the blurred cover: opened from the lyrics panel's expand button. */
export function LyricsStage() {
  const t = useT();
  const open = useUi((s) => s.lyricsStage);
  const setOpen = useUi((s) => s.setLyricsStage);
  const track = usePlayer((s) => s.queue[s.index]);

  // Back closes the stage, and only the stage (not the player or page under it): Escape, Android's Back
  // (native/android.ts turns it into Escape), the mouse's back button and Alt+Left.
  useEffect(() => {
    if (!open) return;
    const close = (e: Event) => {
      e.preventDefault();
      e.stopImmediatePropagation();
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" || e.key === "BrowserBack" || e.key === "GoBack" || (e.altKey && e.key === "ArrowLeft")) close(e);
    };
    // Chromium goes back on the back button's mouseup; cancelling both halves keeps the page where it is.
    const onMouse = (e: MouseEvent) => {
      if (e.button !== 3) return;
      if (e.type === "mouseup") close(e);
      else e.preventDefault();
    };
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("mousedown", onMouse, true);
    window.addEventListener("mouseup", onMouse, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("mousedown", onMouse, true);
      window.removeEventListener("mouseup", onMouse, true);
    };
  }, [open, setOpen]);

  // Nothing playing any more: nothing to show.
  useEffect(() => {
    if (open && !track) setOpen(false);
  }, [open, track, setOpen]);

  return (
    <AnimatePresence>
      {open && track && (
        <motion.div
          role="dialog"
          aria-modal="true"
          aria-label={t.lyrics.title}
          data-escape-closes
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.25 }}
          className="safe-top fixed inset-0 z-[70] flex flex-col overflow-hidden bg-bg"
        >
          {track.art && (
            <img
              src={track.art}
              alt=""
              aria-hidden="true"
              className="pointer-events-none absolute inset-0 size-full scale-125 object-cover opacity-35 blur-3xl"
            />
          )}
          <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-bg/40 via-bg/20 to-bg/70" />

          <header className="relative flex items-center gap-3 px-4 pt-4 md:px-8 md:pt-6">
            {track.thumb && <img src={track.thumb} alt="" className="size-12 rounded-[10px] object-cover shadow-lg" />}
            <div className="min-w-0 flex-1">
              <p className="truncate font-semibold">{track.title}</p>
              <p className="truncate text-sm text-fg-2">
                <ArtistLinks track={track} onNavigate={() => setOpen(false)} />
              </p>
            </div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label={t.lyrics.closeStage}
              title={t.lyrics.closeStage}
              className="grid size-10 place-items-center rounded-full bg-surface-1/60 text-fg-2 ring-1 ring-line backdrop-blur hover:text-fg"
            >
              <XIcon size={18} />
            </button>
          </header>

          <div className="relative mx-auto flex min-h-0 w-full max-w-3xl flex-1 flex-col pb-4">
            <LyricsView track={track} size="stage" />
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
