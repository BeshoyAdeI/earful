import { Fragment, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router";
import { useT } from "../i18n";
import { api } from "../lib/api";
import { cn } from "../lib/format";
import { NOW_PLAYING_HASH, paths } from "../lib/routes";
import type { Track } from "../lib/types";
import { toast } from "../stores/ui";

const linkClass = "app-no-drag pointer-events-auto relative cursor-pointer hover:underline";

export function ArtistLinks({
  track,
  fallback,
  onNavigate,
}: {
  track: Pick<Track, "artist" | "artists">;
  fallback?: string;
  onNavigate?: () => void;
}) {
  const t = useT();
  const navigate = useNavigate();
  const location = useLocation();
  const replace = location.hash === `#${NOW_PLAYING_HASH}`;
  const [loading, setLoading] = useState<string | null>(null);
  const artists: NonNullable<Track["artists"]> = track.artists?.length
    ? track.artists
    : track.artist.split(", ").map((name) => ({ name: name.trim() })).filter((a) => a.name);

  const resolve = async (name: string) => {
    if (loading) return;
    setLoading(name);
    try {
      const id = await api.artistId(name);
      if (id) {
        onNavigate?.();
        navigate(paths.artist(id), { state: { name }, replace });
      } else {
        toast(t.artist.openFailed, "error");
      }
    } catch {
      toast(t.artist.openFailed, "error");
    } finally {
      setLoading(null);
    }
  };

  return artists.length ? artists.map(({ id, name }, index) => (
    <Fragment key={`${name}-${index}`}>
      {index > 0 && ", "}
      {id ? (
        <Link
          to={paths.artist(id)}
          state={{ name }}
          replace={replace}
          className={linkClass}
          onClick={(event) => {
            event.stopPropagation();
            if (event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) onNavigate?.();
          }}
          onContextMenu={(event) => event.stopPropagation()}
        >
          {name}
        </Link>
      ) : (
        <button
          type="button"
          className={cn(linkClass, loading === name && "opacity-60")}
          aria-busy={loading === name}
          onClick={(event) => {
            event.stopPropagation();
            void resolve(name);
          }}
          onContextMenu={(event) => event.stopPropagation()}
        >
          {name}
        </button>
      )}
    </Fragment>
  )) : fallback ?? null;
}
