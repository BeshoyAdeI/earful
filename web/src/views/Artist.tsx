import { MusicNotesIcon, WarningCircleIcon } from "@phosphor-icons/react";
import { useEffect, useRef, useState } from "react";
import { useLocation, useParams } from "react-router";
import { AlbumRow } from "../components/AlbumTiles";
import { Artwork } from "../components/Artwork";
import { BackButton, EmptyState, PageHeader } from "../components/Page";
import { SelectableTrackList } from "../components/Selection";
import { TrackListSkeleton } from "../components/TrackList";
import { useRemote } from "../hooks/useRemote";
import { useI18n, useT } from "../i18n";
import { api } from "../lib/api";
import { paths } from "../lib/routes";
import { cn } from "../lib/format";
import type { ArtistPage, Track } from "../lib/types";

/**
 * Every song of the artist, 50 at a time: the page arrives with the first 50, then the next ones load as the list
 * scrolls into view. The first page is fetched again once with album and year filled in (they take a moment).
 */
function AllSongs({ artistId, first, more }: { artistId: string; first: Track[]; more: boolean }) {
  const t = useT();
  const [tracks, setTracks] = useState(first);
  const [next, setNext] = useState<number | null>(more ? first.length : null);
  const [total, setTotal] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const sentinel = useRef<HTMLDivElement>(null);
  const busy = useRef(false);

  // Years and albums for the first page, and the real total.
  useEffect(() => {
    const ctrl = new AbortController();
    api.artistSongs(artistId, 0, ctrl.signal).then(
      (page) => {
        setTracks((shown) => (shown.length <= page.tracks.length ? page.tracks : [...page.tracks, ...shown.slice(page.tracks.length)]));
        setNext((n) => (n === null || n <= page.tracks.length ? page.next : n));
        setTotal(page.total);
      },
      () => {},
    );
    return () => ctrl.abort();
  }, [artistId]);

  const loadMore = async () => {
    if (busy.current || next === null) return;
    busy.current = true;
    setLoading(true);
    try {
      const page = await api.artistSongs(artistId, next);
      setTracks((shown) => {
        const seen = new Set(shown.map((x) => x.id));
        return [...shown, ...page.tracks.filter((x) => !seen.has(x.id))];
      });
      setNext(page.next);
      setTotal(page.total);
    } catch {
      // Leave "next" as it is: scrolling back down tries again.
    } finally {
      busy.current = false;
      setLoading(false);
    }
  };

  useEffect(() => {
    const el = sentinel.current;
    if (!el || next === null) return;
    const io = new IntersectionObserver((entries) => entries.some((e) => e.isIntersecting) && void loadMore(), { rootMargin: "600px" });
    io.observe(el);
    return () => io.disconnect();
  });

  return (
    <>
      {total !== null && <p className="px-4 text-sm text-fg-3 md:px-6">{t.artist.songCount(total)}</p>}
      <SelectableTrackList
        tracks={tracks}
        numbered
        noteFor={(track) => (track.year || track.album ? <span className="text-fg-3"> · {[track.album, track.year].filter(Boolean).join(" · ")}</span> : null)}
      />
      {next !== null && (
        <div ref={sentinel} className="flex justify-center py-4">
          {loading ? (
            <span role="status" className="text-sm text-fg-3">{t.artist.loadingMore}</span>
          ) : (
            <button type="button" onClick={() => void loadMore()} className="h-10 rounded-full bg-surface-3 px-5 text-sm font-medium hover:bg-surface-4">
              {t.genre.loadMore}
            </button>
          )}
        </div>
      )}
    </>
  );
}

/** An artist's songs (all of them), then albums and singles. */
export default function Artist() {
  const { id = "" } = useParams();
  const location = useLocation();
  const lang = useI18n((s) => s.lang);
  const t = useT();
  // The bio comes from YouTube Music in the app language.
  const page = useRemote<ArtistPage>(`artist:${lang}:${id}`, (signal) => api.artist(id, signal));
  const [fullBio, setFullBio] = useState(false);
  const name = (page.status === "ok" && page.data.name) || (location.state as { name?: string } | null)?.name || t.artist.fallbackName;

  return (
    <div className="pb-8">
      <PageHeader title={name} actions={<BackButton fallback={paths.search} />} />

      <div className="relative mx-4 overflow-hidden rounded-[20px] bg-surface-2 ring-1 ring-line md:mx-6">
        {page.status === "ok" && page.data.banner && (
          <div className="absolute inset-0">
            <Artwork src={page.data.banner} className="size-full" />
          </div>
        )}
        {page.status === "loading" && <div className="skeleton absolute inset-0" />}
        <div aria-hidden="true" className="absolute inset-0 bg-linear-to-t from-black/80 via-black/25 to-transparent" />
        <div className="relative flex min-h-44 flex-col justify-end gap-1 p-5 md:min-h-60 md:p-8">
          <span className="text-xs font-medium text-white/75">{t.artist.label}</span>
          <h1 className="text-[28px] leading-[1.1] font-bold tracking-tight break-words text-white md:text-5xl">{name}</h1>
        </div>
      </div>

      {page.status === "ok" && page.data.description && (
        <button
          type="button"
          onClick={() => setFullBio((v) => !v)}
          aria-expanded={fullBio}
          className={cn("mx-4 mt-4 max-w-[75ch] text-left text-sm text-fg-2 hover:text-fg md:mx-6", !fullBio && "line-clamp-3")}
        >
          {page.data.description}
        </button>
      )}

      <h2 className="px-4 pt-6 pb-1 text-xl font-semibold tracking-tight md:px-6">{t.artist.hits}</h2>

      {page.status === "loading" && <TrackListSkeleton />}

      {page.status === "error" && (
        <EmptyState
          icon={<WarningCircleIcon size={28} />}
          title={t.artist.openFailed}
          body={page.message}
          action={
            <button
              type="button"
              onClick={page.retry}
              className="mt-2 h-11 rounded-full bg-surface-3 px-6 text-sm font-medium hover:bg-surface-4"
            >
              {t.common.retry}
            </button>
          }
        />
      )}

      {page.status === "ok" &&
        (page.data.tracks.length ? (
          <AllSongs key={id} artistId={id} first={page.data.tracks} more={page.data.moreTracks} />
        ) : (
          <EmptyState icon={<MusicNotesIcon size={28} />} title={t.artist.noHits} body={t.artist.noHitsBody} />
        ))}

      {page.status === "ok" && page.data.albums.length > 0 && <AlbumRow title={t.artist.albums} albums={page.data.albums} />}
      {page.status === "ok" && page.data.singles.length > 0 && <AlbumRow title={t.artist.singles} albums={page.data.singles} />}
    </div>
  );
}
