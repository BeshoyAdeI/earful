import { useRef, useState } from "react";
import { useNavigate } from "react-router";
import { useT } from "../i18n";
import { closePlaylistFile, usePlaylistFile } from "../lib/openPlaylistFile";
import { paths } from "../lib/routes";
import { api } from "../lib/api";
import { usePlayer } from "../player/player";
import { useLibrary } from "../stores/library";
import { toast } from "../stores/ui";
import { Cover } from "./Cover";
import { Modal } from "./Modal";

export function PlaylistFileDialog() {
  const t = useT();
  const file = usePlaylistFile((s) => s.files[0]);
  const navigate = useNavigate();
  const [adding, setAdding] = useState(false);
  const pending = useRef(false);
  // The same playlist is already here (shared before): adding updates it instead of making a copy.
  const mine = useLibrary((s) => (file?.id ? s.playlists.find((p) => p.id === file.id) : undefined));

  const close = () => {
    if (file && !pending.current) closePlaylistFile(file);
  };

  const add = async () => {
    if (!file || pending.current) return;
    pending.current = true;
    setAdding(true);
    try {
      const library = useLibrary.getState();
      // Read the current library before checking names, including playlists created from another client.
      await library.load();
      const { playlists, status } = useLibrary.getState();
      if (status !== "ready") return toast(t.playlistFile.addFailed, "error");

      const same = file.id ? playlists.find((p) => p.id === file.id) : undefined;
      if (same) {
        // Merge by id: songs it doesn't have yet are added, nothing is removed or duplicated.
        const result = await api.importLibrary({
          format: "earful-backup",
          version: 1,
          library: {
            favorites: [],
            history: [],
            playlists: [{ id: same.id, name: same.name, createdAt: same.createdAt, updatedAt: Date.now(), tracks: file.tracks }],
          },
        }, "merge");
        await library.load();
        toast(result.tracksAdded ? t.playlistFile.updated(same.name, result.tracksAdded) : t.playlistFile.upToDate(same.name));
        navigate(paths.playlist(same.id));
        closePlaylistFile(file);
        return;
      }

      const base = file.name.slice(0, 80).trimEnd();
      let name = base;
      let suffix = 2;
      while (true) {
        const matches = playlists.filter((p) => p.name === name);
        const existing = matches.find((p) =>
          p.tracks.length === file.tracks.length && p.tracks.every((track, i) => track.id === file.tracks[i]?.id),
        );
        if (existing) {
          navigate(paths.playlist(existing.id));
          break;
        }
        if (!matches.length) {
          const created = await library.createPlaylist(name, file.tracks, file.id);
          if (!created) return;
          navigate(paths.playlist(created.id));
          break;
        }
        const number = ` (${suffix++})`;
        name = base.slice(0, 80 - number.length).trimEnd() + number;
      }
      closePlaylistFile(file);
    } finally {
      pending.current = false;
      setAdding(false);
    }
  };

  return (
    <Modal open={!!file} onClose={close} title={t.playlistFile.open}>
      {file && (
        <>
          <div className="flex items-center gap-4">
            <Cover kind="playlist" tracks={file.tracks} className="size-20 shrink-0 rounded-xl" />
            <div className="min-w-0">
              <h3 className="font-semibold break-words">{file.name}</h3>
              <p className="text-sm text-fg-2">{t.common.songs(file.tracks.length)}</p>
              {mine && <p className="mt-1 text-xs text-accent-text">{t.playlistFile.alreadyHave(mine.name)}</p>}
            </div>
          </div>
          <div className="mt-5 flex flex-wrap justify-end gap-2">
            <button type="button" disabled={adding} onClick={close} className="h-11 rounded-full px-4 text-sm text-fg-2 hover:text-fg disabled:opacity-50">
              {t.common.cancel}
            </button>
            <button
              type="button"
              disabled={adding || !file.tracks.length}
              onClick={() => {
                usePlayer.getState().playList(file.tracks);
                close();
              }}
              className="h-11 rounded-full bg-surface-3 px-4 text-sm font-medium hover:bg-surface-4 disabled:opacity-50"
            >
              {t.common.play}
            </button>
            <button type="button" disabled={adding} onClick={() => void add()} className="h-11 rounded-full bg-accent px-4 text-sm font-semibold text-accent-ink disabled:opacity-50">
              {mine ? t.playlistFile.update : t.playlistFile.add}
            </button>
          </div>
        </>
      )}
    </Modal>
  );
}
