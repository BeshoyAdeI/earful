import type { Messages } from "../i18n";
import type { StatsRange } from "./apiTypes";
import type { ProfileRange } from "../stores/profile";

export const DAY_MS = 86_400_000;
export const dayKey = (day: number) => new Date(day * DAY_MS).toISOString().slice(0, 10);
export const dayNumber = (key: string) => Date.parse(key) / DAY_MS;

export function listeningRange(range: ProfileRange, now = new Date()): StatsRange {
  const tzOffsetMin = -now.getTimezoneOffset();
  if (range === "all") return { from: null, to: null, tzOffsetMin };
  const offset = tzOffsetMin * 60_000;
  const day = Math.floor((now.getTime() + offset) / DAY_MS);
  const date = new Date(day * DAY_MS);
  let from: number;
  if (range === "days7" || range === "days30") {
    from = (day - (range === "days7" ? 6 : 29)) * DAY_MS;
  } else if (range === "year") {
    from = Date.UTC(date.getUTCFullYear(), 0, 1);
  } else {
    const year = date.getUTCFullYear();
    const month = date.getUTCMonth() - 6;
    const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
    from = Date.UTC(year, month, Math.min(date.getUTCDate(), lastDay));
  }
  return { from: from - offset, to: (day + 1) * DAY_MS - offset, tzOffsetMin };
}

export function playCount(plays: number, t: Messages): string {
  return t.profile.playCount(plays, plays.toLocaleString(t.locale));
}

export function minutesListened(seconds: number, t: Messages): string {
  return t.profile.minutes(Math.floor(seconds / 60).toLocaleString(t.locale));
}

export function hoursListened(seconds: number, t: Messages): string {
  const minutes = Math.floor(seconds / 60);
  return t.profile.hoursMinutes(Math.floor(minutes / 60).toLocaleString(t.locale), (minutes % 60).toLocaleString(t.locale));
}
