import { CaretRightIcon, ChartBarIcon, PencilSimpleIcon, PlayIcon, ShareNetworkIcon, ShuffleIcon, TrashIcon } from "@phosphor-icons/react";
import { useEffect, useState } from "react";
import { Link } from "react-router";
import { Artwork } from "../components/Artwork";
import { ListeningCharts } from "../components/ListeningCharts";
import { Modal } from "../components/Modal";
import { EmptyState, PageHeader, Section } from "../components/Page";
import { ProfileAvatar, useProfileName } from "../components/ProfileAvatar";
import { ProfileSegments } from "../components/ProfileSegments";
import { ShareStats } from "../components/ShareStats";
import { AlbumGrid, ArtistGrid, ArtistName, statCard } from "../components/TopItems";
import { TrackList } from "../components/TrackList";
import { useT } from "../i18n";
import { api, type Stats, type StatsRange } from "../lib/api";
import { shuffled } from "../lib/format";
import { hoursListened, listeningRange, minutesListened, playCount } from "../lib/profileStats";
import { discardCurrentListen, usePlayer } from "../player/player";
import { paths } from "../lib/routes";
import { profileRanges, useProfile, type ProfileRange } from "../stores/profile";
import { toast } from "../stores/ui";

const card = statCard;
const button = "inline-flex min-h-10 items-center justify-center gap-2 rounded-full px-4 text-sm font-semibold transition-colors disabled:opacity-50";
const secondary = `${button} bg-surface-3 text-fg hover:bg-surface-4`;

function ProfileHeader({ firstPlayAt }: { firstPlayAt: number | null }) {
  const t = useT();
  const name = useProfileName();
  const setName = useProfile((s) => s.setName);
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <header className="flex items-center gap-4 py-2 sm:gap-6">
      <ProfileAvatar name={name} className="size-[68px] text-3xl sm:size-24 sm:text-4xl" />
      <div className="min-w-0 flex-1">
        <h1 className="mb-1 text-sm font-medium text-fg-2">{t.profile.title}</h1>
        {draft === null ? (
          <button type="button" aria-label={t.profile.editName} onClick={() => setDraft(name)}
            className="group flex max-w-full items-center gap-2 text-left text-3xl font-semibold tracking-tight hover:text-accent-text sm:text-4xl">
            <bdi className="truncate">{name}</bdi>
            <PencilSimpleIcon size={17} className="shrink-0 text-fg-2 group-hover:text-accent-text" />
          </button>
        ) : (
          <input autoFocus aria-label={t.profile.editName} dir="auto" placeholder={t.profile.listener}
            value={draft} maxLength={60} onFocus={(event) => event.currentTarget.select()}
            onChange={(event) => setDraft(event.currentTarget.value)}
            onBlur={(event) => {
              setName(event.currentTarget.value === name ? useProfile.getState().name : event.currentTarget.value);
              setDraft(null);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.nativeEvent.isComposing) event.currentTarget.blur();
              if (event.key === "Escape") setDraft(null);
            }}
            className="w-full min-w-0 rounded-xl bg-surface-1 px-2 py-1 text-2xl font-semibold ring-1 ring-line sm:text-3xl" />
        )}
        {firstPlayAt !== null && (
          <p className="mt-1.5 text-sm text-fg-2">{t.profile.since(new Date(firstPlayAt).toLocaleDateString(t.locale, { dateStyle: "long" }))}</p>
        )}
      </div>
    </header>
  );
}

function Totals({ stats }: { stats: Stats }) {
  const t = useT();
  const p = t.profile;
  const { seconds, plays, songs, artists, albums, activeDays } = stats.totals;
  const tiles: [string, number][] = [
    [p.plays, plays], [p.songs, songs], [p.artists, artists], [p.albums, albums],
    [p.activeDays, activeDays], [p.currentStreak, stats.streaks.current],
    [p.longestStreak, stats.streaks.longest], [p.newArtists, stats.newArtists],
  ];
  return (
    <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-5">
      <div className={`${card} col-span-2 flex flex-col justify-center p-4 lg:row-span-2 lg:p-6`}>
        <dt className="text-sm font-medium text-fg-2">{p.minutesLabel}</dt>
        <dd className="break-words font-mono text-3xl font-semibold tracking-tight text-accent-text tabular-nums sm:text-4xl">
          {minutesListened(seconds, t)}
        </dd>
        {seconds >= 7_200 && <dd className="mt-1 font-mono text-sm text-fg-2 tabular-nums">{hoursListened(seconds, t)}</dd>}
      </div>
      {tiles.map(([label, value]) => (
        <div key={label} className={`${card} p-3 sm:p-4`}>
          <dt className="text-sm text-fg-2">{label}</dt>
          <dd className="mt-1 break-words font-mono text-xl font-semibold tabular-nums">{value.toLocaleString(t.locale)}</dd>
        </div>
      ))}
    </dl>
  );
}

const PREVIEW = { songs: 10, artists: 12, albums: 12 };

/** Opens the full, paginated list on its own page (views/ProfileTop.tsx). */
function ShowAll({ kind }: { kind: "songs" | "artists" | "albums" }) {
  const t = useT();
  return (
    <Link to={paths.profileTop(kind)} className={`${secondary} w-fit`}>
      {t.profile.showAll} <CaretRightIcon size={14} />
    </Link>
  );
}

function Rankings({ stats }: { stats: Stats }) {
  const t = useT();
  const p = t.profile;
  const tracks = stats.topSongs.map(({ track }) => track);
  const counts = new Map(stats.topSongs.map(({ track, plays }) => [track.id, plays]));
  const top = stats.topArtists[0];
  const playList = usePlayer((s) => s.playList);
  return (
    <>
      {top && (
        <section className={`${card} flex items-center gap-4 p-4 sm:gap-6 sm:p-6`}>
          <Artwork src={top.thumb} className="aspect-square w-[30%] max-w-44 rounded-[16px]" iconSize={32} />
          <div className="min-w-0">
            <h2 className="text-sm font-medium text-accent-text">{p.topArtist}</h2>
            <p className="mt-1 break-words text-2xl font-semibold tracking-tight sm:text-4xl"><ArtistName artist={top} /></p>
            <p className="mt-2 font-mono text-sm text-fg-2 tabular-nums">{p.chartValue(playCount(top.plays, t), minutesListened(top.seconds, t))}</p>
          </div>
        </section>
      )}
      {tracks.length > 0 && (
        <Section title={p.topSongs} action={(
          <div className="flex gap-2">
            <button type="button" className={`${button} bg-accent text-accent-ink`} onClick={() => playList(tracks)}>
              <PlayIcon size={16} weight="fill" />{t.common.play}
            </button>
            <button type="button" className={`${secondary} !px-3`} aria-label={t.collection.shuffle} title={t.collection.shuffle}
              onClick={() => playList(shuffled(tracks))}>
              <ShuffleIcon size={17} /><span className="hidden sm:inline">{t.collection.shuffle}</span>
            </button>
          </div>
        )}>
          <TrackList tracks={tracks.slice(0, PREVIEW.songs)} context={tracks} header={false} showAlbum={false}
            rowDetail={(track) => playCount(counts.get(track.id) ?? 0, t)} />
          {tracks.length > PREVIEW.songs && <ShowAll kind="songs" />}
        </Section>
      )}
      {top && (
        <Section title={p.topArtists}>
          <ArtistGrid artists={stats.topArtists.slice(0, PREVIEW.artists)} />
          {stats.topArtists.length > PREVIEW.artists && <ShowAll kind="artists" />}
        </Section>
      )}
      {stats.topAlbums.length > 0 && (
        <Section title={p.topAlbums}>
          <AlbumGrid albums={stats.topAlbums.slice(0, PREVIEW.albums)} />
          {stats.topAlbums.length > PREVIEW.albums && <ShowAll kind="albums" />}
        </Section>
      )}
    </>
  );
}

type Result = { choice: ProfileRange; stats: Stats; range: StatsRange } | { choice: ProfileRange; error: true };

export default function Profile() {
  const t = useT();
  const p = t.profile;
  const name = useProfileName();
  const choice = useProfile((s) => s.range);
  const setRange = useProfile((s) => s.setRange);
  const [result, setResult] = useState<Result>();
  const [firstPlayAt, setFirstPlayAt] = useState<number | null>(null);
  const [refresh, setRefresh] = useState(0);
  const [sharing, setSharing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [clearing, setClearing] = useState(false);

  useEffect(() => {
    let controller: AbortController | undefined;
    const load = () => {
      controller?.abort();
      const request = controller = new AbortController();
      const range = listeningRange(choice);
      void api.stats(range, request.signal).then((stats) => {
        if (request.signal.aborted) return;
        setFirstPlayAt(stats.firstPlayAt);
        setResult({ choice, stats, range });
      }).catch(() => {
        if (!request.signal.aborted) setResult({ choice, error: true });
      });
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") load();
    };
    load();
    window.addEventListener("earful:play-recorded", load);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      controller?.abort();
      window.removeEventListener("earful:play-recorded", load);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [choice, refresh]);

  const current = result?.choice === choice ? result : undefined;
  const data = current && "stats" in current ? current : undefined;
  const hasActivity = !!data?.stats.totals.seconds;
  const clear = async () => {
    setClearing(true);
    try {
      await api.clearPlays();
      discardCurrentListen();
      setFirstPlayAt(null);
      setResult(undefined);
      setConfirming(false);
      setRefresh((v) => v + 1);
      toast(p.clearDone);
    } catch {
      toast(p.clearError, "error");
    } finally {
      setClearing(false);
    }
  };
  return (
    <>
      <PageHeader mobileOnly />
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 pb-8 pt-4 md:px-6 md:pt-8">
        <ProfileHeader firstPlayAt={firstPlayAt} />
        <ProfileSegments label={p.range} labels={p} options={profileRanges} value={choice} onChange={(value) => {
          if (value !== choice) {
            setResult(undefined);
            setRange(value);
          }
        }} />
        {!current ? (
          <div role="status" aria-label={p.loading} className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {Array.from({ length: 8 }, (_, i) => (
              <div key={i} className={`${card} skeleton h-20`} />
            ))}
            <div className={`${card} skeleton col-span-full h-40`} />
          </div>
        ) : !data ? (
          <div role="alert" className={`${card} space-y-3 p-5`}>
            <p>{p.loadError}</p>
            <button type="button" className={secondary} onClick={() => { setResult(undefined); setRefresh((v) => v + 1); }}>{p.retry}</button>
          </div>
        ) : hasActivity ? (
          <>
            <Totals stats={data.stats} />
            <ListeningCharts stats={data.stats} range={data.range} />
            <div>
              <button type="button" className={`${button} bg-accent text-accent-ink`} onClick={() => setSharing(true)}>
                <ShareNetworkIcon size={18} />{p.share}
              </button>
            </div>
            <Rankings key={choice} stats={data.stats} />
          </>
        ) : (
          <EmptyState icon={<ChartBarIcon size={32} />} title={p.emptyTitle} body={p.empty} />
        )}
        <footer className="flex flex-wrap gap-2">
          <button type="button" className={`${button} text-fg-2 hover:bg-surface-3`} onClick={() => setConfirming(true)}>
            <TrashIcon size={18} />{p.clear}
          </button>
        </footer>
      </div>
      {sharing && data && <ShareStats stats={data.stats} name={name} range={choice} onClose={() => setSharing(false)} />}
      <Modal open={confirming} title={p.clear} onClose={() => { if (!clearing) setConfirming(false); }}>
        <p className="text-sm text-fg-2">{p.clearConfirm}</p>
        <div className="mt-4 flex flex-wrap justify-end gap-2">
          <button type="button" disabled={clearing} className={secondary} onClick={() => setConfirming(false)}>{t.common.cancel}</button>
          <button type="button" disabled={clearing} className={`${button} bg-danger/15 text-danger hover:bg-danger/25`} onClick={() => void clear()}>
            {p.clear}
          </button>
        </div>
      </Modal>
    </>
  );
}
