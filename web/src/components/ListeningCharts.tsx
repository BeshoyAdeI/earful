import { useT } from "../i18n";
import type { Stats, StatsRange } from "../lib/apiTypes";
import { DAY_MS, dayKey, dayNumber } from "../lib/profileStats";

const panel = "min-w-0 rounded-[20px] bg-surface-1 p-4 ring-1 ring-line md:p-5";
const chartHeading = "text-lg font-semibold tracking-tight";

function Bars({ entries, markers, summary }: {
  entries: { label: string; value: number }[];
  markers: { index: number; label: string }[];
  summary: string;
}) {
  const t = useT();
  const peak = Math.max(1, ...entries.map(({ value }) => value));
  const columns = { gridTemplateColumns: `repeat(${entries.length}, minmax(0, 1fr))` };
  return (
    <div role="img" aria-label={summary}>
      <div aria-hidden="true" className="grid h-24 items-end gap-0.5 border-b border-line sm:gap-1.5" style={columns}>
        {entries.map(({ label, value }, index) => (
          <div key={index} title={t.profile.chartValue(label, t.profile.seconds(value.toLocaleString(t.locale, { maximumFractionDigits: 3 })))}
            className="min-h-0.5 rounded-t bg-accent-text/80"
            style={{ height: `${(value / peak) * 100}%`, opacity: value ? 1 : 0.16 }} />
        ))}
      </div>
      <div aria-hidden="true" className="mt-2 grid font-mono text-[10px] text-fg-2 tabular-nums sm:text-xs" style={columns}>
        {markers.map(({ index, label }) => <span key={index} className="whitespace-nowrap" style={{ gridColumn: index + 1 }}>{label}</span>)}
      </div>
    </div>
  );
}

export function ListeningCharts({ stats, range }: { stats: Stats; range: StatsRange }) {
  const t = useT();
  const hourFormat = new Intl.DateTimeFormat(t.locale, { hour: "numeric", timeZone: "UTC" });
  const hourLabel = (hour: number) => hourFormat.format(new Date(Date.UTC(2024, 0, 1, hour)));
  const weekdayFormat = new Intl.DateTimeFormat(t.locale, { weekday: "short", timeZone: "UTC" });
  const dateFormat = new Intl.DateTimeFormat(t.locale, { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
  const weekdayLabel = (index: number) => weekdayFormat.format(new Date(Date.UTC(2024, 0, index + 1)));
  const peak = stats.peakHour === null ? "" : t.profile.peak(hourLabel(stats.peakHour));
  const exactTime = (seconds: number) => t.profile.seconds(seconds.toLocaleString(t.locale, { maximumFractionDigits: 3 }));
  const summary = (detail: string) => t.profile.chartSummary(exactTime(stats.totals.seconds), detail);
  const busiestDay = stats.byWeekday.indexOf(Math.max(...stats.byWeekday));
  const fullWeekday = new Intl.DateTimeFormat(t.locale, { weekday: "long", timeZone: "UTC" });
  const weekdaySummary = summary(t.profile.busiestDay(fullWeekday.format(new Date(Date.UTC(2024, 0, busiestDay + 1)))));
  const { activeDays } = stats.totals;
  const activitySummary = summary(t.profile.activitySummary(activeDays, activeDays.toLocaleString(t.locale)));
  const daySeconds = new Map(stats.daily.map(({ day, seconds }) => [dayNumber(day), seconds]));
  const offset = range.tzOffsetMin * 60_000;
  const short = range.from !== null && range.to !== null && range.to - range.from <= 30 * DAY_MS;
  const first = short && range.from !== null ? Math.floor((range.from + offset) / DAY_MS) : dayNumber(stats.daily[0].day);
  const last = short && range.to !== null ? Math.ceil((range.to + offset) / DAY_MS) - 1 : dayNumber(stats.daily.at(-1)!.day);
  const dateLabel = (day: number) => dateFormat.format(new Date(day * DAY_MS));

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <section className={panel}>
        <h2 className={chartHeading}>{t.profile.clock}</h2>
        {peak && <p className="mb-3 text-sm text-accent-text">{peak}</p>}
        <Bars entries={stats.byHour.map((value, index) => ({ label: hourLabel(index), value }))}
          markers={[0, 6, 12, 18].map((index) => ({ index, label: hourLabel(index) }))} summary={summary(peak)} />
      </section>
      <section className={panel}>
        <h2 className={`${chartHeading} mb-3`}>{t.profile.weekdays}</h2>
        <Bars entries={stats.byWeekday.map((value, index) => ({ label: weekdayLabel(index), value }))}
          markers={stats.byWeekday.map((_, index) => ({ index, label: weekdayLabel(index) }))} summary={weekdaySummary} />
      </section>
      <section className={`${panel} lg:col-span-2`}>
        <h2 className={`${chartHeading} mb-3`}>{t.profile.activity}</h2>
        {short ? (
          <Bars entries={Array.from({ length: last - first + 1 }, (_, i) => ({
            label: dateLabel(first + i), value: daySeconds.get(first + i) ?? 0,
          }))}
            markers={Array.from({ length: Math.ceil((last - first + 1) / 7) }, (_, week) => ({
              index: week * 7,
              label: (first + week * 7 === first
                ? new Intl.DateTimeFormat(t.locale, { month: "short", day: "numeric", timeZone: "UTC" })
                : new Intl.DateTimeFormat(t.locale, { day: "numeric", timeZone: "UTC" }))
                .format(new Date((first + week * 7) * DAY_MS)),
            }))} summary={activitySummary} />
        ) : (
          <Heatmap first={first} last={last} values={daySeconds} summary={activitySummary} />
        )}
      </section>
    </div>
  );
}

function Heatmap({ first, last, values, summary }: { first: number; last: number; values: Map<number, number>; summary: string }) {
  const t = useT();
  const start = first - (((first + 3) % 7 + 7) % 7);
  const weeks = Math.floor((last - start) / 7) + 1;
  let max = 1;
  for (const seconds of values.values()) max = Math.max(max, seconds);
  const format = new Intl.DateTimeFormat(t.locale, { dateStyle: "medium", timeZone: "UTC" });
  const monthFormat = new Intl.DateTimeFormat(t.locale, { month: "short", timeZone: "UTC" });
  return (
    <div role="img" aria-label={summary} tabIndex={0} className="scroll-area overflow-x-auto pb-2">
      <div aria-hidden="true" className="grid w-max grid-flow-col grid-rows-[1rem_repeat(7,0.75rem)] gap-[3px]"
        style={{ gridAutoColumns: "0.75rem" }}>
        {Array.from({ length: weeks }, (_, week) => {
          const monday = start + week * 7;
          const date = new Date(monday * DAY_MS);
          const month = !week || date.getUTCDate() <= 7 ? monthFormat.format(date) : "";
          return [
            <span key={`month-${week}`} className="whitespace-nowrap text-[10px] text-fg-2">{month}</span>,
            ...Array.from({ length: 7 }, (_, weekday) => {
              const day = monday + weekday;
              if (day < first || day > last) return <span key={day} />;
              const seconds = values.get(day) ?? 0;
              const level = seconds ? Math.ceil(4 * Math.sqrt(seconds / max)) : 0;
              return <span key={dayKey(day)}
                title={t.profile.chartValue(format.format(new Date(day * DAY_MS)), t.profile.seconds(seconds.toLocaleString(t.locale, { maximumFractionDigits: 3 })))}
                className="rounded-[3px] bg-accent-text" style={{ opacity: [0.13, 0.34, 0.53, 0.75, 1][level] }} />;
            }),
          ];
        })}
      </div>
    </div>
  );
}
