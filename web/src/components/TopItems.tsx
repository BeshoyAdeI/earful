import { useT } from "../i18n";
import type { Stats } from "../lib/api";
import { playCount } from "../lib/profileStats";
import { ArtistLinks } from "./ArtistLinks";
import { Artwork } from "./Artwork";

/** The profile's card style, shared by its tiles and the "Show all" pages. */
export const statCard = "min-w-0 rounded-[20px] bg-surface-1 ring-1 ring-line";

type Artist = Stats["topArtists"][number];
type Album = Stats["topAlbums"][number];

export function ArtistName({ artist }: { artist: Artist }) {
  return <ArtistLinks track={{ artist: artist.name, artists: [{ name: artist.name, id: artist.id }] }} />;
}

/** A grid of top artists. `ranked`: number them, the first one being `start + 1` (a page of a longer list). */
export function ArtistGrid({ artists, start = 0, ranked = false }: { artists: Artist[]; start?: number; ranked?: boolean }) {
  const t = useT();
  return (
    <ul className="grid grid-cols-3 gap-3 sm:grid-cols-4 lg:grid-cols-6">
      {artists.map((artist, i) => (
        <li key={artist.name} className={`${statCard} relative space-y-1 p-2 text-center sm:p-3`}>
          {ranked && <span className="absolute top-2 left-2.5 font-mono text-xs text-fg-3 tabular-nums">{start + i + 1}</span>}
          <Artwork src={artist.thumb} className="mx-auto mb-2 aspect-square w-full max-w-32 rounded-full" />
          <p className="truncate text-sm font-semibold" title={artist.name}><ArtistName artist={artist} /></p>
          <p className="font-mono text-xs text-fg-2 tabular-nums">{playCount(artist.plays, t)}</p>
        </li>
      ))}
    </ul>
  );
}

/** A grid of top albums. `ranked`: number them, the first one being `start + 1` (a page of a longer list). */
export function AlbumGrid({ albums, start = 0, ranked = false }: { albums: Album[]; start?: number; ranked?: boolean }) {
  const t = useT();
  return (
    <ul className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
      {albums.map((album, i) => (
        <li key={JSON.stringify([album.name, album.artist])} className={`${statCard} relative space-y-1 p-3`}>
          {ranked && (
            <span className="absolute top-4 left-4 z-10 rounded-full bg-bg/70 px-1.5 font-mono text-xs text-fg tabular-nums">{start + i + 1}</span>
          )}
          <Artwork src={album.thumb} className="mb-2 aspect-square w-full rounded-[12px]" />
          <p className="truncate text-sm font-semibold" title={album.name}>{album.name}</p>
          <p className="truncate text-xs text-fg-2" title={album.artist}>{album.artist}</p>
          <p className="font-mono text-xs text-fg-2 tabular-nums">{playCount(album.plays, t)}</p>
        </li>
      ))}
    </ul>
  );
}
