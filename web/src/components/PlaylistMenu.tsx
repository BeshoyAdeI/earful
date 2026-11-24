import { DownloadSimpleIcon, ExportIcon, ListPlusIcon, PencilSimpleIcon, PlayIcon, ShuffleIcon, TrashIcon } from "@phosphor-icons/react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useLayoutEffect, useRef, useState, type MouseEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useLocation, useNavigate } from "react-router";
import { MD, useMediaQuery } from "../hooks/useMediaQuery";
import { useT } from "../i18n";
import { cn, shuffled } from "../lib/format";
import { sharePlaylistFile } from "../lib/openPlaylistFile";
import { paths } from "../lib/routes";
import { usePlayer } from "../player/player";
import { useDownloads } from "../stores/downloads";
import { useLibrary } from "../stores/library";
import { usePlaylistPlays } from "../stores/playlistPlays";
import { useUi } from "../stores/ui";
import { Artwork } from "./Artwork";
import { NamePlaylistDialog } from "./Dialogs";
import { Modal } from "./Modal";

/** Opens the playlist menu at the pointer: for `onContextMenu` on any link to a playlist (right-click, long-press). */
export const playlistMenuAt = (id: string) => (e: MouseEvent) => {
  e.preventDefault();
  e.stopPropagation();
  useUi.getState().openPlaylistMenu({ id, x: e.clientX, y: e.clientY });
};

function Item({ icon, children, onClick, danger, disabled }: { icon: ReactNode; children: ReactNode; onClick: () => void; danger?: boolean; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left text-[15px] transition-colors disabled:opacity-40 md:py-2 md:text-sm",
        "hover:bg-surface-3 focus-visible:bg-surface-3",
        danger ? "text-danger" : "text-fg",
      )}
    >
      <span className={cn("shrink-0", danger ? "text-danger" : "text-fg-2")}>{icon}</span>
      {children}
    </button>
  );
}

/**
 * A playlist's menu, from the sidebar, the Library and Home: play, shuffle, queue, download, share, rename, delete.
 * The same actions as the playlist page's buttons and its "…" menu. A popover on desktop, a bottom sheet on phones.
 */
export function PlaylistMenu() {
  const menu = useUi((s) => s.playlistMenu);
  const close = useUi((s) => s.closePlaylistMenu);
  const playlist = useLibrary((s) => (menu ? s.playlists.find((p) => p.id === menu.id) : undefined));
  const isMd = useMediaQuery(MD);
  const box = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: 0, top: 0 });
  // Rename and delete outlive the menu: they open after it closes.
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null);
  const [deleting, setDeleting] = useState<{ id: string; name: string; count: number } | null>(null);
  const navigate = useNavigate();
  const location = useLocation();
  const t = useT();

  useLayoutEffect(() => {
    if (!menu || !isMd || !box.current) return;
    const { width, height } = box.current.getBoundingClientRect();
    setPos({
      left: Math.min(menu.x, window.innerWidth - width - 12),
      top: menu.y + height > window.innerHeight - 12 ? Math.max(12, menu.y - height) : menu.y,
    });
  }, [menu, isMd]);

  useEffect(() => {
    if (!menu) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    window.addEventListener("keydown", onKey);
    window.addEventListener("resize", close);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", close);
    };
  }, [menu, close]);

  // The playlist was deleted elsewhere while the menu was open.
  useEffect(() => {
    if (menu && !playlist) close();
  }, [menu, playlist, close]);

  const run = (fn: () => void) => () => {
    fn();
    close();
  };

  const content = playlist && (
    <div role="menu" aria-label={t.trackMenu.actionsFor(playlist.name)} data-escape-closes className="flex flex-col">
      <Item
        icon={<PlayIcon size={18} />}
        disabled={!playlist.tracks.length}
        onClick={run(() => {
          usePlaylistPlays.getState().markPlayed(playlist.id);
          usePlayer.getState().playList(playlist.tracks, 0);
        })}
      >
        {t.common.play}
      </Item>
      <Item
        icon={<ShuffleIcon size={18} />}
        disabled={!playlist.tracks.length}
        onClick={run(() => {
          usePlaylistPlays.getState().markPlayed(playlist.id);
          usePlayer.getState().playList(shuffled(playlist.tracks), 0);
        })}
      >
        {t.collection.shuffle}
      </Item>
      <Item
        icon={<ListPlusIcon size={18} />}
        disabled={!playlist.tracks.length}
        onClick={run(() => usePlayer.getState().addManyToQueue(playlist.tracks))}
      >
        {t.trackMenu.addToQueue}
      </Item>
      <div className="mx-3 my-1 h-px bg-line" />
      <Item
        icon={<DownloadSimpleIcon size={18} />}
        disabled={!playlist.tracks.length}
        onClick={run(() => void useDownloads.getState().download(playlist.tracks))}
      >
        {t.offline.downloadAll}
      </Item>
      <Item icon={<ExportIcon size={18} />} onClick={run(() => void sharePlaylistFile(playlist.name, playlist.tracks, playlist.id))}>
        {t.playlistFile.share}
      </Item>
      <Item icon={<PencilSimpleIcon size={18} />} onClick={run(() => setRenaming({ id: playlist.id, name: playlist.name }))}>
        {t.collection.rename}
      </Item>
      <Item
        danger
        icon={<TrashIcon size={18} />}
        onClick={run(() => setDeleting({ id: playlist.id, name: playlist.name, count: playlist.tracks.length }))}
      >
        {t.collection.deletePlaylist}
      </Item>
    </div>
  );

  return (
    <>
      {createPortal(
        <AnimatePresence>
          {menu && playlist && (
            <div className="fixed inset-0 z-50" onContextMenu={(e) => e.preventDefault()}>
              <motion.div
                className={cn("absolute inset-0", isMd ? "bg-transparent" : "bg-scrim")}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                onClick={close}
              />
              {isMd ? (
                <motion.div
                  ref={box}
                  initial={{ opacity: 0, scale: 0.97 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.97 }}
                  transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
                  style={pos}
                  className="absolute w-60 origin-top-left rounded-2xl border border-line-strong bg-surface-2 p-1.5 shadow-[0_16px_48px_rgb(0_0_0/0.45)]"
                >
                  {content}
                </motion.div>
              ) : (
                <motion.div
                  initial={{ y: "100%" }}
                  animate={{ y: 0 }}
                  exit={{ y: "100%" }}
                  transition={{ type: "spring", stiffness: 420, damping: 40 }}
                  className="island safe-bottom absolute inset-x-0 bottom-0 rounded-b-none"
                >
                  <div className="island-core p-2">
                    <div className="mx-auto mt-1 mb-2 h-1 w-9 rounded-full bg-surface-4" />
                    <div className="flex items-center gap-3 px-3 pb-3">
                      <Artwork src={playlist.tracks[0]?.thumb} className="size-12 rounded-[10px]" />
                      <div className="min-w-0">
                        <p className="truncate font-medium">{playlist.name}</p>
                        <p className="truncate text-sm text-fg-2">{t.common.tracks(playlist.tracks.length)}</p>
                      </div>
                    </div>
                    <div className="mx-3 mb-1 h-px bg-line" />
                    {content}
                  </div>
                </motion.div>
              )}
            </div>
          )}
        </AnimatePresence>,
        document.body,
      )}

      <NamePlaylistDialog
        open={!!renaming}
        initial={renaming?.name}
        title={t.collection.renameTitle}
        action={t.collection.save}
        onClose={() => setRenaming(null)}
        onSubmit={(name) => {
          if (renaming) void useLibrary.getState().renamePlaylist(renaming.id, name);
          setRenaming(null);
        }}
      />

      <Modal open={!!deleting} onClose={() => setDeleting(null)} title={t.collection.deleteTitle}>
        <p className="text-sm text-fg-2">{deleting && t.collection.deleteBody(deleting.name, deleting.count)}</p>
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={() => setDeleting(null)} className="h-11 rounded-full px-5 text-sm font-medium text-fg-2 hover:text-fg">
            {t.common.cancel}
          </button>
          <button
            type="button"
            onClick={() => {
              if (!deleting) return;
              void useLibrary.getState().deletePlaylist(deleting.id);
              // Deleting the playlist that's open: leave its page.
              if (location.pathname === paths.playlist(deleting.id)) navigate(paths.library);
              setDeleting(null);
            }}
            className="h-11 rounded-full bg-danger px-6 text-sm font-semibold text-white"
          >
            {t.collection.delete}
          </button>
        </div>
      </Modal>
    </>
  );
}
