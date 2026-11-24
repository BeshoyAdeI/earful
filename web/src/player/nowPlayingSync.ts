import { desktop } from "../lib/desktop";
import { usePlayer } from "./player";

/**
 * Shows what's playing outside the page: the window or tab title ("Song – Artist"), and on Windows the taskbar's
 * previous, play/pause and next buttons (desktop/src/thumbar.mts), whose clicks come back here.
 */
let sent = "";

const sync = () => {
  const s = usePlayer.getState();
  const track = s.queue[s.index];
  const title = track ? [track.title, track.artist].filter(Boolean).join(" – ") : "Earful";
  if (document.title !== title) document.title = title;
  // The player updates many times a second (the position): tell the desktop app only what changed.
  const media = { playing: s.status === "playing" || s.status === "loading", hasTrack: !!track };
  const key = `${media.playing}|${media.hasTrack}`;
  if (key !== sent) {
    sent = key;
    desktop?.setMedia?.(media);
  }
};

sync();
usePlayer.subscribe(sync);

desktop?.onMediaCommand?.((command) => {
  const player = usePlayer.getState();
  if (command === "prev") player.prev();
  else if (command === "next") player.next();
  else if (command === "toggle") player.toggle();
});
