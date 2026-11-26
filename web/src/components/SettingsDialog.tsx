import {
  ArrowsClockwiseIcon,
  CheckCircleIcon,
  DownloadSimpleIcon,
  MoonIcon,
  SunIcon,
  TranslateIcon,
  WarningCircleIcon,
} from "@phosphor-icons/react";
import { useEffect, useEffectEvent, useRef, useState, type ReactNode } from "react";
import { MD, useMediaQuery } from "../hooks/useMediaQuery";
import { LANGUAGES, useI18n, useT, type Lang } from "../i18n";
import { api, capabilities, type Channel, type DiscordStatus } from "../lib/api";
import { cn } from "../lib/format";
import { useAppUpdate } from "../stores/appUpdate";
import { useSystem } from "../stores/system";
import { toast, useUi, type SettingsSection } from "../stores/ui";
import { BackupSection } from "./BackupSection";
import { SyncSection, useSyncHost } from "./SyncSection";
import { UpdateSection } from "./UpdateSection";
import { OfflineSection } from "./OfflineSection";
import { SpotifyImport } from "./SpotifyImport";
import { AccentPicker, LayoutSection } from "./CustomizeSection";
import { Modal } from "./Modal";

function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: [T, ReactNode][];
  onChange: (v: T) => void;
}) {
  return (
    <div role="radiogroup" aria-label={label} className="flex rounded-full bg-surface-1 p-1 ring-1 ring-line">
      {options.map(([v, content]) => (
        <button
          key={v}
          type="button"
          role="radio"
          aria-checked={value === v}
          onClick={() => onChange(v)}
          className={cn(
            "flex h-9 flex-1 items-center justify-center gap-1.5 rounded-full px-3 text-[13px] font-medium transition-colors duration-200",
            value === v ? "bg-surface-4 text-fg shadow-[inset_0_1px_0_var(--highlight)]" : "text-fg-2 hover:text-fg",
          )}
        >
          {content}
        </button>
      ))}
    </div>
  );
}

function Dependency({ name, role, path, fix }: { name: string; role: string; path: string | null; fix: string }) {
  const t = useT();
  return (
    <li className="flex items-center gap-3 py-2.5" title={path ?? undefined}>
      {path ? (
        <CheckCircleIcon size={20} weight="fill" className="shrink-0 text-accent-text" />
      ) : (
        <WarningCircleIcon size={20} weight="fill" className="shrink-0 text-danger" />
      )}
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium">{name}</span>
        <span className="block text-xs text-fg-2">
          {path ? (
            role
          ) : (
            <>
              {t.settings.depMissingBefore} <code className="font-mono text-fg">{fix}</code> {t.settings.depMissingAfter}
            </>
          )}
        </span>
      </span>
    </li>
  );
}

const sections: SettingsSection[] = ["appearance", "playback", "offline", "sync", "backup", "updates", "engine"];
const sectionId = (section: SettingsSection) => `settings-${section}`;

function SettingsGroup({ section, children }: { section: SettingsSection; children: ReactNode }) {
  const t = useT();
  const id = sectionId(section);
  return (
    <div className="shrink-0 last:min-h-full last:pb-2">
      <section id={id} aria-labelledby={`${id}-title`} className="relative flex flex-col gap-4 rounded-[16px]">
        <span aria-hidden="true" data-settings-highlight className="pointer-events-none absolute -inset-1 rounded-[20px] opacity-0 ring-2 ring-accent" />
        <h3 id={`${id}-title`} className="text-base font-semibold tracking-tight">{t.settings.groups[section]}</h3>
        {children}
      </section>
    </div>
  );
}

export function SettingsDialog() {
  const open = useUi((s) => s.settingsOpen);
  const setOpen = useUi((s) => s.setSettingsOpen);
  const focus = useUi((s) => s.settingsFocus);
  const theme = useUi((s) => s.theme);
  const setTheme = useUi((s) => s.setTheme);
  const { info, status, load, update } = useSystem();
  const [channel, setChannel] = useState<Channel>("stable");
  const [discord, setDiscordStatus] = useState<DiscordStatus | null>();
  const [savingDiscord, setSavingDiscord] = useState(false);
  const logBox = useRef<HTMLPreElement>(null);
  const scrollBox = useRef<HTMLDivElement>(null);
  const nav = useRef<HTMLElement>(null);
  const highlight = useRef<Animation>(null);
  const [active, setActive] = useState<SettingsSection>("appearance");
  const syncHost = useSyncHost(open);
  const showPlayback = discord?.available === true;
  const showSync = !!api.syncClient || !!syncHost.status;
  const showUpdates = useAppUpdate((s) => s.state.status !== "unsupported");
  const visibility: Partial<Record<SettingsSection, boolean>> = {
    playback: showPlayback, sync: showSync, updates: showUpdates, engine: capabilities.engineSettings,
  };
  const waitingForSection = (focus?.section === "playback" && discord === undefined) ||
    (focus?.section === "sync" && !!api.syncHost && syncHost.status === undefined);
  const t = useT();
  const lang = useI18n((s) => s.lang);
  const setLang = useI18n((s) => s.setLang);
  const isMd = useMediaQuery(MD);

  const jumpTo = (section: SettingsSection) => {
    const target = scrollBox.current?.querySelector<HTMLElement>(`#${sectionId(section)}`);
    if (!target) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    target.scrollIntoView({ behavior: reduce ? "instant" : "smooth", block: "start" });
    highlight.current?.cancel();
    highlight.current = target.querySelector("[data-settings-highlight]")?.animate(
      [{ opacity: 1 }, { opacity: 0 }],
      { duration: 1500, easing: reduce ? "steps(1, end)" : "ease-out" },
    ) ?? null;
  };

  const applyFocus = useEffectEvent((section?: SettingsSection) => {
    if (section) jumpTo(section);
    else {
      highlight.current?.cancel();
      setActive("appearance");
      scrollBox.current?.scrollTo({ top: 0, behavior: "instant" });
    }
  });

  useEffect(() => {
    if (!open || !focus || waitingForSection) return;
    applyFocus(focus.section);
    useUi.setState((s) => s.settingsFocus === focus ? { settingsFocus: null } : s);
  }, [open, focus, waitingForSection]);

  useEffect(() => {
    const root = scrollBox.current;
    if (!open || !root) return;
    const groups = sections.flatMap((section) => {
      const element = root.querySelector(`#${sectionId(section)}`);
      return element ? [{ section, element }] : [];
    });
    const visible = new Set<Element>();
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) visible.add(entry.target);
        else visible.delete(entry.target);
      }
      const first = groups.find(({ element }) => visible.has(element));
      if (first) setActive(first.section);
    }, { root });
    for (const { element } of groups) observer.observe(element);
    return () => observer.disconnect();
  }, [open, showPlayback, showSync, showUpdates]);

  useEffect(() => {
    const list = nav.current;
    const button = list?.querySelector('[aria-current="location"]');
    if (!open || isMd || !list || !button || list.scrollWidth <= list.clientWidth) return;
    const bounds = list.getBoundingClientRect();
    const chip = button.getBoundingClientRect();
    list.scrollBy({ left: Math.min(0, chip.left - bounds.left - 4) + Math.max(0, chip.right - bounds.right + 4) });
  }, [open, active, isMd, lang]);

  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  useEffect(() => {
    if (!open || savingDiscord || discord?.available === false) return;
    let active = true;
    const refresh = () => {
      void api.discordStatus().then((status) => {
        if (active) setDiscordStatus(status);
      }).catch(() => {
        if (active) setDiscordStatus((current) => current ?? null);
      });
    };
    refresh();
    const interval = setInterval(refresh, 3000);
    return () => {
      active = false;
      clearInterval(interval);
    };
  }, [open, savingDiscord, discord?.available]);

  const toggleDiscord = async (enabled: boolean) => {
    setSavingDiscord(true);
    try {
      setDiscordStatus(await api.setDiscord(enabled));
    } catch {
      toast(t.discord.saveFailed, "error");
    } finally {
      setSavingDiscord(false);
    }
  };

  useEffect(() => {
    if (info) setChannel(info.ytdlp.channel);
  }, [info?.ytdlp.channel]);

  const job = info?.job;
  const running = job?.status === "running";

  useEffect(() => {
    logBox.current?.scrollTo({ top: logBox.current.scrollHeight });
  }, [job?.log.length]);

  const y = info?.ytdlp;
  const missing = !!info && !y?.path;
  const switching = !!y?.version && channel !== y.channel;
  const target = y?.latest[channel];

  let action: string;
  if (running) action = job?.kind === "install" ? t.settings.installing : t.settings.updating;
  else if (missing) action = t.settings.install;
  else if (switching) action = channel === "nightly" ? t.settings.toNightly : t.settings.toStable;
  else if (y?.updateAvailable && target) action = t.settings.updateTo(target);
  else action = t.settings.check;

  const chip = !info ? null : missing ? (
    <span className="rounded-full bg-danger/15 px-2.5 py-1 text-xs font-medium text-danger">{t.settings.chipMissing}</span>
  ) : y?.updateAvailable ? (
    <span className="rounded-full bg-accent-soft px-2.5 py-1 text-xs font-medium text-accent-text">{t.settings.chipUpdate}</span>
  ) : (
    <span className="rounded-full bg-surface-3 px-2.5 py-1 text-xs font-medium text-fg-2">{t.settings.chipOk}</span>
  );

  return (
    <Modal open={open} onClose={() => setOpen(false)} title={t.settings.title} wide>
      <div className="grid gap-3 md:grid-cols-[10rem_minmax(0,1fr)] md:gap-5">
        <nav
          ref={nav}
          aria-label={t.settings.navigation}
          className="scroll-area -mx-1 flex min-w-0 gap-2 overflow-x-auto p-1 md:sticky md:top-0 md:mx-0 md:max-h-[min(70dvh,calc(100dvh-6rem))] md:flex-col md:gap-1 md:self-start md:overflow-x-hidden md:overflow-y-auto"
        >
          {sections.filter((section) => visibility[section] !== false).map((section) => (
            <button
              key={section}
              type="button"
              aria-controls={sectionId(section)}
              aria-current={active === section ? "location" : undefined}
              onClick={() => jumpTo(section)}
              className={cn(
                "shrink-0 rounded-full px-3.5 py-2 text-left text-sm font-medium whitespace-nowrap transition-colors md:rounded-xl md:whitespace-normal",
                active === section ? "bg-accent-soft text-accent-text" : "bg-surface-3 text-fg-2 hover:text-fg md:bg-transparent md:hover:bg-surface-3",
              )}
            >
              {t.settings.groups[section]}
            </button>
          ))}
        </nav>
        <div ref={scrollBox} className="scroll-area -mx-2 flex h-[min(70dvh,calc(100dvh-9rem))] min-w-0 flex-col gap-7 overflow-y-auto overscroll-contain scroll-pt-2 px-2 pt-2 md:h-[min(70dvh,calc(100dvh-6rem))]">
          <SettingsGroup section="appearance">
            <section className="flex flex-col gap-2">
              <h4 className="text-xs font-medium text-fg-3">{t.settings.theme}</h4>
              <Segmented
                label={t.settings.theme}
                value={theme}
                onChange={setTheme}
                options={[
                  ["dark", <><MoonIcon size={15} /> {t.settings.dark}</>],
                  ["light", <><SunIcon size={15} /> {t.settings.light}</>],
                ]}
              />
              <AccentPicker />
            </section>

            <section className="flex flex-col gap-2">
              <h4 className="flex items-center gap-1.5 text-xs font-medium text-fg-3">
                <TranslateIcon size={14} /> {t.settings.language}
              </h4>
              <Segmented
                label={t.settings.language}
                value={lang}
                onChange={setLang}
                options={LANGUAGES.map(({ id, name }): [Lang, ReactNode] => [id, <span lang={id}>{name}</span>])}
              />
            </section>

            <LayoutSection />
          </SettingsGroup>

          {discord?.available && (
            <SettingsGroup section="playback">
              <h4 className="text-xs font-medium text-fg-3">{t.discord.title}</h4>
              <div className="space-y-1 rounded-xl bg-surface-1 p-3 ring-1 ring-line">
                <label className="flex cursor-pointer items-center justify-between gap-3 text-sm">
                  {t.discord.toggle}
                  <input
                    type="checkbox"
                    role="switch"
                    className="size-4 shrink-0 accent-accent"
                    checked={discord.enabled}
                    disabled={savingDiscord}
                    onChange={(event) => void toggleDiscord(event.currentTarget.checked)}
                  />
                </label>
                {discord.enabled && (
                  <p className="text-xs text-accent-text">{discord.connected ? t.discord.connected : t.discord.waiting}</p>
                )}
                <p className="text-xs text-fg-2">{t.discord.note}</p>
              </div>
            </SettingsGroup>
          )}

          <SettingsGroup section="offline"><OfflineSection /></SettingsGroup>
          {showSync && <SettingsGroup section="sync"><SyncSection host={syncHost} open={open} /></SettingsGroup>}
          <SettingsGroup section="backup">
            <BackupSection />
            <SpotifyImport />
          </SettingsGroup>
          {showUpdates && <SettingsGroup section="updates"><UpdateSection /></SettingsGroup>}

          {capabilities.engineSettings && (
            <SettingsGroup section="engine">
              <h4 className="text-xs font-medium text-fg-3">{t.settings.engine}</h4>

              <div className="flex flex-col gap-4 rounded-[16px] bg-surface-1 p-4 ring-1 ring-line">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-semibold tracking-tight">yt-dlp</p>
                    <p className="font-mono text-[13px] text-fg-2 tabular-nums">
                      {status === "loading" && !info ? t.settings.checking : y?.version ?? t.settings.noVersion}
                      {y?.version && <span className="text-fg-3"> · {y.channel === "nightly" ? t.settings.nightly : t.settings.stable}</span>}
                    </p>
                  </div>
                  {chip}
                </div>

                <p className="text-sm text-fg-2">
                  {t.settings.engineBody}
                </p>

                {!missing && (
                  <div className="flex flex-col gap-1.5">
                    <Segmented
                      label={t.settings.channel}
                      value={channel}
                      onChange={setChannel}
                      options={[
                        ["stable", t.settings.stableOption],
                        ["nightly", t.settings.nightlyOption],
                      ]}
                    />
                    <p className="px-1 text-xs text-fg-3">
                      {channel === "nightly"
                        ? t.settings.nightlyBody + (y?.latest.nightly ? t.settings.latest(y.latest.nightly) : "")
                        : t.settings.stableBody + (y?.latest.stable ? t.settings.latest(y.latest.stable) : "")}
                    </p>
                  </div>
                )}

                <button
                  type="button"
                  disabled={running || !info || (missing && !info.canInstall)}
                  onClick={() => void update(channel)}
                  className="flex h-12 items-center justify-center gap-2 rounded-full bg-accent px-6 font-semibold text-accent-ink transition-transform active:scale-[0.98] disabled:opacity-60"
                >
                  {running ? (
                    <ArrowsClockwiseIcon size={20} weight="bold" className="animate-spin" />
                  ) : missing ? (
                    <DownloadSimpleIcon size={20} weight="bold" />
                  ) : (
                    <ArrowsClockwiseIcon size={20} weight="bold" />
                  )}
                  {action}
                </button>

                {missing && info && !info.canInstall && (
                  <p className="text-sm text-danger">
                    {t.settings.noWinget}
                  </p>
                )}

                {job && (job.status === "running" || Date.now() - (job.finishedAt ?? 0) < 5 * 60_000) && (
                  <div className="flex flex-col gap-2">
                    {job.status !== "running" && (
                      <p className={cn("text-sm font-medium", job.status === "error" ? "text-danger" : "text-accent-text")}>
                        {job.message}
                      </p>
                    )}
                    <pre
                      ref={logBox}
                      aria-live="polite"
                      className="max-h-36 overflow-y-auto rounded-[10px] bg-bg p-3 font-mono text-[11px] leading-relaxed whitespace-pre-wrap text-fg-2 scroll-area"
                    >
                      {job.log.length ? job.log.join("\n") : t.settings.starting}
                    </pre>
                  </div>
                )}
              </div>

              {info && (
                <ul className="divide-y divide-line px-1">
                  <Dependency name="Deno" role={t.settings.denoRole} path={info.deno} fix="winget install DenoLand.Deno" />
                  <Dependency name="FFmpeg" role={t.settings.ffmpegRole} path={info.ffmpeg} fix="winget install yt-dlp.FFmpeg" />
                </ul>
              )}
            </SettingsGroup>
          )}
        </div>
      </div>
    </Modal>
  );
}
