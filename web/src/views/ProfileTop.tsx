import { CaretLeftIcon, CaretRightIcon, ChartBarIcon, PlayIcon, ShuffleIcon } from "@phosphor-icons/react";
import { useEffect, useState } from "react";
import { Link, Navigate, useParams, useSearchParams } from "react-router";
import { EmptyState, PageHeader } from "../components/Page";
import { ProfileSegments } from "../components/ProfileSegments";
import { AlbumGrid, ArtistGrid, statCard } from "../components/TopItems";
import { TrackList } from "../components/TrackList";
import { useT } from "../i18n";
import { api, type Stats } from "../lib/api";
import { shuffled } from "../lib/format";
import { listeningRange, playCount } from "../lib/profileStats";
import { paths } from "../lib/routes";
import { usePlayer } from "../player/player";
import { profileRanges, useProfile, type ProfileRange } from "../stores/profile";

const PAGE_SIZE = 50;
const TOP = 1000;
const KINDS = ["songs", "artists", "albums"] as const;
type Kind = (typeof KINDS)[number];

const button = "inline-flex min-h-10 items-center justify-center gap-2 rounded-full px-4 text-sm font-semibold transition-colors disabled:opacity-40";
const secondary = `${button} bg-surface-3 text-fg hover:bg-surface-4`;

/** "Show all" from the profile: every top song, artist or album for the chosen period, 50 per page. */
export default function ProfileTop() {
  const { kind } = useParams();
  if (!KINDS.includes(kind as Kind)) return <Navigate to={paths.profile} replace />;
  return <TopPage kind={kind as Kind} />;
}

type Result = { choice: ProfileRange; stats: Stats } | { choice: ProfileRange; error: true };

function TopPage({ kind }: { kind: Kind }) {
  const t = useT();
  const p = t.profile;
  const choice = useProfile((s) => s.range);
  const setRange = useProfile((s) => s.setRange);
  const [params, setParams] = useSearchParams();
  const [result, setResult] = useState<Result>();
  const [attempt, setAttempt] = useState(0);
  const playList = usePlayer((s) => s.playList);

  useEffect(() => {
    const controller = new AbortController();
    api.stats({ ...listeningRange(choice), top: TOP }, controller.signal).then(
      (stats) => !controller.signal.aborted && setResult({ choice, stats }),
      () => !controller.signal.aborted && setResult({ choice, error: true }),
    );
    return () => controller.abort();
  }, [choice, attempt]);

  const current = result?.choice === choice ? result : undefined;
  const stats = current && "stats" in current ? current.stats : undefined;
  const items = !stats ? [] : kind === "songs" ? stats.topSongs : kind === "artists" ? stats.topArtists : stats.topAlbums;
  const pages = Math.max(1, Math.ceil(items.length / PAGE_SIZE));
  const page = Math.min(pages, Math.max(1, Number(params.get("page")) || 1));
  const start = (page - 1) * PAGE_SIZE;
  const goTo = (next: number) => {
    setParams(next > 1 ? { page: String(next) } : {});
    document.querySelector("main")?.scrollTo({ top: 0 });
  };
  const title = kind === "songs" ? p.topSongs : kind === "artists" ? p.topArtists : p.topAlbums;

  const tracks = stats?.topSongs.map(({ track }) => track) ?? [];
  const counts = new Map(stats?.topSongs.map(({ track, plays }) => [track.id, plays]));

  const pager = pages > 1 && (
    <nav aria-label={p.pages} className="flex items-center justify-center gap-2">
      <button type="button" className={`${secondary} !px-3`} disabled={page <= 1} onClick={() => goTo(page - 1)} aria-label={p.previousPage}>
        <CaretLeftIcon size={16} />
      </button>
      <span className="min-w-28 text-center font-mono text-sm text-fg-2 tabular-nums">{p.pageOf(page, pages)}</span>
      <button type="button" className={`${secondary} !px-3`} disabled={page >= pages} onClick={() => goTo(page + 1)} aria-label={p.nextPage}>
        <CaretRightIcon size={16} />
      </button>
    </nav>
  );

  return (
    <>
      <PageHeader mobileOnly title={title} />
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 pb-8 pt-4 md:px-6 md:pt-8">
        <div className="flex flex-col gap-1">
          <Link to={paths.profile} className="inline-flex w-fit items-center gap-1 text-sm font-medium text-fg-2 hover:text-fg">
            <CaretLeftIcon size={14} /> {p.backToProfile}
          </Link>
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">{title}</h1>
              {stats && <p className="mt-1 font-mono text-sm text-fg-2 tabular-nums">{p.topCount(items.length)}</p>}
            </div>
            {kind === "songs" && tracks.length > 0 && (
              <div className="flex gap-2">
                <button type="button" className={`${button} bg-accent text-accent-ink`} onClick={() => playList(tracks)}>
                  <PlayIcon size={16} weight="fill" />{t.common.play}
                </button>
                <button type="button" className={`${secondary} !px-3`} aria-label={t.collection.shuffle} title={t.collection.shuffle}
                  onClick={() => playList(shuffled(tracks))}>
                  <ShuffleIcon size={17} /><span className="hidden sm:inline">{t.collection.shuffle}</span>
                </button>
              </div>
            )}
          </div>
        </div>

        <ProfileSegments label={p.range} labels={p} options={profileRanges} value={choice} onChange={(value) => {
          if (value === choice) return;
          setResult(undefined);
          setParams({});
          setRange(value);
        }} />

        {!current ? (
          <div role="status" aria-label={p.loading} className={`${statCard} skeleton h-96`} />
        ) : !stats ? (
          <div role="alert" className={`${statCard} space-y-3 p-5`}>
            <p>{p.loadError}</p>
            <button type="button" className={secondary} onClick={() => { setResult(undefined); setAttempt((v) => v + 1); }}>{p.retry}</button>
          </div>
        ) : items.length === 0 ? (
          <EmptyState icon={<ChartBarIcon size={32} />} title={p.emptyTitle} body={p.empty} />
        ) : (
          <>
            {pager}
            {kind === "songs" ? (
              <TrackList tracks={tracks.slice(start, start + PAGE_SIZE)} context={tracks} offset={start} header={false} showAlbum={false}
                rowDetail={(track) => playCount(counts.get(track.id) ?? 0, t)} />
            ) : kind === "artists" ? (
              <ArtistGrid artists={stats.topArtists.slice(start, start + PAGE_SIZE)} start={start} ranked />
            ) : (
              <AlbumGrid albums={stats.topAlbums.slice(start, start + PAGE_SIZE)} start={start} ranked />
            )}
            {pager}
          </>
        )}
      </div>
    </>
  );
}
