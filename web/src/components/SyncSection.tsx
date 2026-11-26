import { ArrowsClockwiseIcon, DeviceMobileIcon, DesktopIcon, LockSimpleIcon, QrCodeIcon } from "@phosphor-icons/react";
import qrcode from "qrcode-generator";
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { pairingLink } from "../../../server/src/sync";
import { useT } from "../i18n";
import { api } from "../lib/api";
import type { SyncClientStatus, SyncCounts, SyncStatus } from "../lib/apiTypes";
import { cn } from "../lib/format";
import { toast } from "../stores/ui";
import { QrScanner } from "./QrScanner";

function ago(at: number, locale: string, justNow: string): string {
  const minutes = Math.floor((Date.now() - at) / 60_000);
  if (minutes < 1) return justNow;
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
  if (minutes < 60) return rtf.format(-minutes, "minute");
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return rtf.format(-hours, "hour");
  return rtf.format(-Math.floor(hours / 24), "day");
}

function useRelativeTime(open: boolean) {
  const t = useT();
  const [, refresh] = useState(0);
  useEffect(() => {
    if (!open) return;
    const timer = setInterval(() => refresh((tick) => tick + 1), 30_000);
    return () => clearInterval(timer);
  }, [open]);
  return (at: number) => ago(at, t.locale, t.sync.justNow);
}

const box = "flex flex-col gap-3 rounded-[16px] bg-surface-1 p-4 ring-1 ring-line";
const button = "flex h-10 items-center justify-center gap-2 rounded-full px-4 text-sm font-medium transition-transform active:scale-[0.97] disabled:opacity-50";

function Secure() {
  const t = useT();
  return (
    <p className="flex items-center gap-1.5 text-xs text-fg-3">
      <LockSimpleIcon size={13} /> {t.sync.secure}
    </p>
  );
}

/** The PC's pairing QR code (every address and the code), for the phone to scan. */
function PairingQr({ addresses, code }: { addresses: string[]; code: string }) {
  const t = useT();
  const svg = useMemo(() => {
    const qr = qrcode(0, "M");
    qr.addData(pairingLink(addresses, code));
    qr.make();
    return qr.createSvgTag({ cellSize: 4, margin: 2, scalable: true });
  }, [addresses, code]);
  return (
    <div className="flex flex-col items-center gap-2">
      {/* Dark on white in both themes: cameras read it best that way. */}
      <div role="img" aria-label={t.sync.qrLabel} className="size-44 rounded-[12px] bg-white p-1" dangerouslySetInnerHTML={{ __html: svg }} />
      <p className="text-center text-xs text-fg-2">{t.sync.qrHint}</p>
    </div>
  );
}

export function useSyncHost(open: boolean) {
  const host = api.syncHost;
  const [status, setStatus] = useState<SyncStatus | null>();
  const [busy, setBusy] = useState(false);
  const enabled = status?.enabled === true;

  useEffect(() => {
    if (!host || busy) return;
    let live = true;
    let timer: ReturnType<typeof setTimeout>;
    const load = async () => {
      try {
        const next = await host.status();
        if (live) setStatus(next);
      } catch {
        if (live) setStatus((current) => current ?? null);
      } finally {
        if (live) timer = setTimeout(load, open && enabled ? 2000 : 15_000);
      }
    };
    void load();
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [host, open, enabled, busy]);

  const act = async (job: () => Promise<SyncStatus>) => {
    setBusy(true);
    try {
      setStatus(await job());
    } catch (e) {
      toast((e as Error).message, "error");
    } finally {
      setBusy(false);
    }
  };

  return { host, status, busy, act };
}

/** On the PC: turn sync on, and show the address and code to enter on the phone. */
function HostPanel({ host, open }: { host: ReturnType<typeof useSyncHost>; open: boolean }) {
  const t = useT();
  const when = useRelativeTime(open);
  const { host: controls, status, busy, act } = host;
  if (!controls || !status) return null;

  const activity = status.activity;
  const recent = status.recent?.slice(0, 4) ?? [];
  const { counts, activeWith, fromPhone, waiting, lastSync, hostErrors } = t.sync;
  const countText = ({ favorites, playlists, plays }: SyncCounts) => counts(favorites, playlists, plays);
  const hostMessage = status.syncing
    ? (activity?.from ? activeWith(activity.from) : t.sync.syncing)
    : activity?.phase === "done" && activity.added
      ? fromPhone(when(activity.at), countText(activity.added))
      : status.lastSyncAt && !activity ? lastSync(when(status.lastSyncAt)) : waiting;

  return (
    <section className="flex flex-col gap-3">
      <h4 className="flex items-center gap-1.5 text-xs font-medium text-fg-3">
        <DeviceMobileIcon size={14} /> {t.sync.hostTitle}
      </h4>
      <div className={box}>
        <p className="text-sm text-fg-2">{t.sync.hostBody}</p>
        <label className="flex cursor-pointer items-center justify-between gap-3">
          <span className="text-sm font-medium">{t.sync.enable}</span>
          <input
            type="checkbox"
            checked={status.enabled}
            disabled={busy}
            onChange={(e) => void act(() => controls.setEnabled(e.target.checked))}
            className="peer sr-only"
          />
          <span
            aria-hidden="true"
            className={cn(
              "relative h-6 w-10 shrink-0 rounded-full transition-colors duration-200 peer-focus-visible:outline-2 peer-focus-visible:outline-accent",
              status.enabled ? "bg-accent" : "bg-surface-4",
            )}
          >
            <span
              className={cn(
                "absolute top-1 left-1 size-4 rounded-full transition-transform duration-200 ease-out-expo",
                status.enabled ? "translate-x-4 bg-accent-ink" : "bg-fg-2",
              )}
            />
          </span>
        </label>

        {status.enabled && (
          <>
            {status.listening && status.addresses.length > 0 && (
              <p role="status" className="flex items-start gap-2 text-sm text-fg-2">
                <span aria-hidden="true" className={cn("mt-1.5 size-2 shrink-0 rounded-full bg-accent", status.syncing && "motion-safe:animate-pulse")} />
                {hostMessage}
              </p>
            )}
            {!status.listening ? (
              <p className="text-sm text-danger">{t.sync.notListening}</p>
            ) : status.addresses.length === 0 ? (
              <p className="text-sm text-danger">{t.sync.noNetwork}</p>
            ) : (
              <>
                <PairingQr addresses={status.addresses} code={status.code} />
                <div className="grid gap-2 sm:grid-cols-2">
                  <div className="rounded-[12px] bg-surface-2 px-3 py-2.5">
                    <span className="block text-xs text-fg-3">{t.sync.address}</span>
                    {status.addresses.map((a) => (
                      <span key={a} className="block font-mono text-sm font-semibold select-all">{a}</span>
                    ))}
                  </div>
                  <div className="rounded-[12px] bg-surface-2 px-3 py-2.5">
                    <span className="block text-xs text-fg-3">{t.sync.code}</span>
                    <span className="block font-mono text-sm font-semibold tracking-wide select-all">{status.code}</span>
                  </div>
                </div>
              </>
            )}
            <p className="text-xs text-fg-3">{t.sync.firewall}</p>
            {recent.length > 0 && (
              <div className="rounded-[12px] bg-surface-2 px-3 py-2">
                <p className="text-xs font-medium text-fg-3">{t.sync.recent}</p>
                <ul className="divide-y divide-line">
                  {recent.map(({ at, phase, error, added, from }, i) => (
                    <li key={`${at}-${from}-${i}`} className={cn("flex flex-wrap justify-between gap-x-3 py-1.5 text-xs", phase === "failed" ? "text-danger" : "text-fg-2")}>
                      <span>{phase === "failed" ? hostErrors[error ?? "sync failed"] : added && countText(added)}</span>
                      <time dateTime={new Date(at).toISOString()}>{when(at)}</time>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <div className="flex flex-wrap items-center justify-end gap-2">
              <button
                type="button"
                disabled={busy}
                onClick={() => void act(controls.newCode)}
                title={t.sync.newCodeHint}
                className={cn(button, "bg-surface-3 hover:bg-surface-4")}
              >
                {t.sync.newCode}
              </button>
            </div>
            <Secure />
          </>
        )}
      </div>
    </section>
  );
}

/** On the phone: pair with the PC once, then it syncs by itself. */
function ClientPanel({ client, open }: { client: NonNullable<typeof api.syncClient>; open: boolean }) {
  const t = useT();
  const when = useRelativeTime(open);
  const status = useSyncExternalStore(client.subscribe, client.status);
  const [address, setAddress] = useState("");
  const [code, setCode] = useState("");
  const [pairing, setPairing] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [pairError, setPairError] = useState<string>();

  const errorText = (reason?: string) => (reason && reason in t.sync.errors ? t.sync.errors[reason as keyof typeof t.sync.errors] : undefined);

  const connect = async () => {
    setPairing(true);
    setPairError(undefined);
    try {
      await client.pair(address, code);
      toast(t.sync.synced);
      setCode("");
    } catch (e) {
      const message = errorText((e as Error).message) ?? (e as Error).message;
      setPairError(message);
      toast(message, "error");
    } finally {
      setPairing(false);
    }
  };

  const closeScanner = useCallback(() => setScanning(false), []);
  const onScanned = useCallback(
    async (text: string) => {
      setScanning(false);
      setPairing(true);
      setPairError(undefined);
      try {
        await client.pairFromQr(text);
        toast(t.sync.synced);
      } catch (e) {
        const message = errorText((e as Error).message) ?? (e as Error).message;
        setPairError(message);
        toast(message, "error");
      } finally {
        setPairing(false);
      }
    },
    // errorText only reads `t`.
    [client, t],
  );

  const input =
    "h-11 w-full rounded-full border border-line-strong bg-surface-2 px-4 text-[15px] placeholder:text-fg-3 focus:border-accent focus:outline-none";
  const phases: Partial<Record<NonNullable<SyncClientStatus["phase"]>, string>> = {
    connecting: t.sync.pairing,
    searching: t.sync.searching,
    sending: t.sync.sending,
    merging: t.sync.merging,
  };
  const progress = status.syncing && status.phase !== "done" && status.phase !== "failed" &&
    (status.phase ? phases[status.phase] : t.sync.syncing);
  const result = status.lastResult;
  const summary = result
    ? t.sync.fromPc(when(result.at), t.sync.counts(result.favorites, result.playlists, result.plays))
    : status.lastSyncAt ? t.sync.lastSync(when(status.lastSyncAt)) : t.sync.never;

  return (
    <section className="flex flex-col gap-3">
      <h4 className="flex items-center gap-1.5 text-xs font-medium text-fg-3">
        <DesktopIcon size={14} /> {t.sync.clientTitle}
      </h4>
      <div className={box}>
        {progress && (
          <p role="status" className="flex items-center gap-2 text-sm text-fg-2">
            <ArrowsClockwiseIcon aria-hidden="true" size={16} className="shrink-0 text-accent-text motion-safe:animate-spin" />
            {progress}
          </p>
        )}
        {status.paired && !pairing ? (
          <>
            <p className="text-sm font-medium">{t.sync.pairedWith(status.host ?? "")}</p>
            {!progress && <p role="status" className="text-sm text-fg-2">{summary}</p>}
            {status.error && !progress && <p role="status" className="text-sm text-danger">{errorText(status.error)}</p>}
            <div className="flex flex-wrap justify-end gap-2">
              <button type="button" onClick={() => client.unpair()} className={cn(button, "text-fg-2 hover:text-fg")}>
                {t.sync.unpair}
              </button>
              <button
                type="button"
                disabled={status.syncing}
                onClick={() =>
                  void client.syncNow().then(
                    () => { if (client.status().paired) toast(t.sync.synced); },
                    () => {},
                  )
                }
                className={cn(button, "bg-accent text-accent-ink")}
              >
                <ArrowsClockwiseIcon size={16} /> {t.sync.syncNow}
              </button>
            </div>
          </>
        ) : (
          <form
            className="flex flex-col gap-2.5"
            onSubmit={(e) => {
              e.preventDefault();
              void connect();
            }}
          >
            <p className="text-sm text-fg-2">{t.sync.clientBody}</p>
            {pairError && <p role="status" className="text-sm text-danger">{pairError}</p>}
            <button
              type="button"
              disabled={pairing}
              onClick={() => setScanning(true)}
              className={cn(button, "h-11 bg-accent text-accent-ink")}
            >
              <QrCodeIcon size={18} /> {pairing ? t.sync.pairing : t.sync.scan}
            </button>
            <p className="pt-1 text-xs text-fg-3">{t.sync.orType}</p>
            <input
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              inputMode="url"
              autoCapitalize="off"
              autoCorrect="off"
              placeholder={t.sync.addressPlaceholder}
              aria-label={t.sync.address}
              className={input}
            />
            <input
              value={code}
              onChange={(e) => setCode(e.target.value)}
              autoCapitalize="characters"
              autoCorrect="off"
              spellCheck={false}
              placeholder="ABCD-EFGH-JKMN-PQRS"
              aria-label={t.sync.code}
              className={cn(input, "font-mono tracking-wide")}
            />
            <button type="submit" disabled={pairing || !address.trim() || !code.trim()} className={cn(button, "self-end bg-surface-3 hover:bg-surface-4")}>
              {pairing ? t.sync.pairing : t.sync.pair}
            </button>
          </form>
        )}
        <Secure />
      </div>
      {scanning && <QrScanner onCode={(text) => void onScanned(text)} onClose={closeScanner} />}
    </section>
  );
}

/** Settings → sync between the PC and the phone: the PC's panel on the desktop app, the phone's in the phone app. */
export function SyncSection({ host, open }: { host: ReturnType<typeof useSyncHost>; open: boolean }) {
  if (api.syncClient) return <ClientPanel client={api.syncClient} open={open} />;
  if (host.host) return <HostPanel host={host} open={open} />;
  return null;
}
