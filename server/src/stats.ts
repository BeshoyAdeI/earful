import type { PlayEvent } from "./plays.js";
import type { Track } from "./types.js";

export interface StatsRange {
  from: number | null;
  to: number | null;
  tzOffsetMin: number;
}

export interface Stats {
  range: { from: number | null; to: number | null };
  totals: { plays: number; seconds: number; songs: number; artists: number; albums: number; activeDays: number };
  topSongs: { track: Track; plays: number; seconds: number }[];
  topArtists: { name: string; id?: string; plays: number; seconds: number; thumb: string; songs: number }[];
  topAlbums: { name: string; artist: string; plays: number; seconds: number; thumb: string }[];
  byHour: number[];
  byWeekday: number[];
  daily: { day: string; seconds: number; plays: number }[];
  streaks: { current: number; longest: number };
  firstPlayAt: number | null;
  newArtists: number;
  peakHour: number | null;
}

interface Counts { plays: number; seconds: number }
interface Song extends Counts { event: PlayEvent }
interface Artist extends Counts { name: string; id?: string; songs: Map<string, Song> }
interface Album extends Counts { name: string; artist: string; event: PlayEvent }

const DAY = 86_400_000;
const HOUR = 3_600_000;
const rank = (a: Counts, b: Counts) => b.plays - a.plays || b.seconds - a.seconds;

function add(counts: Counts, event: PlayEvent, play: number) {
  counts.plays += play;
  counts.seconds += event.sec;
}

function addSong(songs: Map<string, Song>, event: PlayEvent, play: number) {
  let song = songs.get(event.id);
  if (!song) {
    song = { event, plays: 0, seconds: 0 };
    songs.set(event.id, song);
  }
  if (event.at >= song.event.at) song.event = event;
  add(song, event, play);
}

export function computeStats(events: PlayEvent[], { from, to, tzOffsetMin }: StatsRange): Stats {
  const inRange = (at: number) => (from === null || at >= from) && (to === null || at < to);
  const offset = tzOffsetMin * 60_000;
  const songs = new Map<string, Song>();
  const artists = new Map<string, Artist>();
  const albums = new Map<string, Album>();
  const firstArtist = new Map<string, number>();
  const days = new Map<number, Counts>();
  const byHour = Array<number>(24).fill(0);
  const byWeekday = Array<number>(7).fill(0);
  const totals = { plays: 0, seconds: 0, songs: 0, artists: 0, albums: 0, activeDays: 0 };
  let firstPlayAt: number | null = null;

  for (const event of events) {
    const { at, sec, duration } = event;
    if (firstPlayAt === null || at < firstPlayAt) firstPlayAt = at;
    const play = Number(sec >= 30 || (duration > 0 && sec >= duration * 0.5));
    const included = inRange(at);
    if (!included && !play) continue;
    const credits: NonNullable<PlayEvent["artists"]> = event.artists?.length
      ? event.artists
      : event.artist.split(", ").map((name) => ({ name }));
    const credited = new Set<string>();
    for (const credit of credits) {
      const name = credit.name.trim();
      const key = name.toLowerCase();
      if (!key || credited.has(key)) continue;
      credited.add(key);
      if (play && at < (firstArtist.get(key) ?? Infinity)) firstArtist.set(key, at);
      if (!included) continue;
      const { id } = credit;
      let artist = artists.get(key);
      if (!artist) {
        artist = { name, id, plays: 0, seconds: 0, songs: new Map() };
        artists.set(key, artist);
      }
      artist.id ??= id;
      add(artist, event, play);
      addSong(artist.songs, event, play);
    }
    if (!included) continue;

    add(totals, event, play);
    addSong(songs, event, play);
    const albumName = event.album?.trim();
    if (albumName) {
      const key = JSON.stringify([albumName.toLowerCase(), event.artist.trim().toLowerCase()]);
      let album = albums.get(key);
      if (!album) {
        album = { name: albumName, artist: event.artist, event, plays: 0, seconds: 0 };
        albums.set(key, album);
      }
      if (event.thumb && event.at >= album.event.at) album.event = event;
      add(album, event, play);
    }

    const local = at + offset;
    const day = Math.floor(local / DAY);
    const hour = Math.floor((local - day * DAY) / HOUR);
    byHour[hour] += sec;
    byWeekday[((day + 3) % 7 + 7) % 7] += sec;
    let activity = days.get(day);
    if (!activity) {
      activity = { plays: 0, seconds: 0 };
      days.set(day, activity);
    }
    add(activity, event, play);
  }

  totals.songs = songs.size;
  totals.artists = artists.size;
  totals.albums = albums.size;
  totals.activeDays = days.size;

  // Tops only list what was really played (a few seconds of a skipped song still count as time, not as a play).
  const played = <T extends { plays: number }>(x: T) => x.plays > 0;
  const topSongs = [...songs.values()].filter(played).sort(rank).slice(0, 50).map(({ event, plays, seconds }) => {
    const { at: _at, sec: _sec, ...metadata } = event;
    const track: Track = { ...metadata, art: event.thumb, kind: "song" };
    return { track, plays, seconds };
  });
  const topArtists = [...artists.values()].filter(played).sort(rank).slice(0, 50).map(({ name, id, plays, seconds, songs }) => {
    let favorite: Song | undefined;
    for (const song of songs.values()) if (!favorite || rank(song, favorite) < 0) favorite = song;
    return { name, id, plays, seconds, thumb: favorite?.event.thumb ?? "", songs: songs.size };
  });
  const topAlbums = [...albums.values()].filter(played).sort(rank).slice(0, 30)
    .map(({ name, artist, event, plays, seconds }) => ({ name, artist, plays, seconds, thumb: event.thumb }));

  const streaks = { current: 0, longest: 0 };
  const today = Math.floor((Date.now() + offset) / DAY);
  let run = 0;
  let previous = -Infinity;
  const active = [...days.keys()].sort((a, b) => a - b);
  const daily: Stats["daily"] = [];
  for (const day of active) {
    for (let gap = previous + 1; Number.isFinite(gap) && gap < day; gap++) {
      daily.push({ day: new Date(gap * DAY).toISOString().slice(0, 10), seconds: 0, plays: 0 });
    }
    run = day === previous + 1 ? run + 1 : 1;
    previous = day;
    streaks.longest = Math.max(streaks.longest, run);
    if (day === today || day === today - 1) streaks.current = run;
    daily.push({ day: new Date(day * DAY).toISOString().slice(0, 10), ...days.get(day)! });
  }

  let newArtists = 0;
  for (const at of firstArtist.values()) if (inRange(at)) newArtists++;
  const peakHour = totals.seconds > 0 ? byHour.indexOf(Math.max(...byHour)) : null;
  return { range: { from, to }, totals, topSongs, topArtists, topAlbums, byHour, byWeekday, daily, streaks, firstPlayAt, newArtists, peakHour };
}
