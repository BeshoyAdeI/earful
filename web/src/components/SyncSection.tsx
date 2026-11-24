import { ArrowsClockwiseIcon, DeviceMobileIcon, DesktopIcon, LockSimpleIcon } from "@phosphor-icons/react";
import { useEffect, useState, useSyncExternalStore } from "react";
import { useT } from "../i18n";
import { api } from "../lib/api";
import type { SyncClientStatus, SyncStatus } from "../lib/apiTypes";
import { cn } from "../lib/format";
import { toast } from "../stores/ui";

/** "3 minutes ago", in the app language. */
function ago(at: number, locale: string): string {
  const minutes = Math.round((at - Date.now()) / 60_000);
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
  if (Math.abs(minutes) < 60) return rtf.format(minutes, "minute");
  const hours = Math.round(minutes / 60);
  if (Math.abs(hours) < 48) return rtf.format(hours, "hour");
  return rtf.format(Math.round(hours / 24), "day");
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

/** On the PC: turn sync on, and show the address and code to enter on the phone. */
function HostPanel({ host }: { host: NonNullable<typeof api.syncHost> }) {
  const t = useT();
  const [status, setStatus] = useState<SyncStatus | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    const load = () => host.status().then((s) => live && setStatus(s), () => live && setStatus(null));
    void load();
    // The last sync time moves while Settings is open.
    const timer = setInterval(load, 15_000);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [host]);

  if (!status) return null; // not this computer's own Earful (a shared server): nothing to set up here

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

  return (
    <section className="flex flex-col gap-3">
      <h3 className="flex items-center gap-1.5 text-xs font-medium text-fg-3">
        <DeviceMobileIcon size={14} /> {t.sync.hostTitle}
      </h3>
      <div className={box}>
        <p className="text-sm text-fg-2">{t.sync.hostBody}</p>
        <label className="flex cursor-pointer items-center justify-between gap-3">
          <span className="text-sm font-medium">{t.sync.enable}</span>
          <input
            type="checkbox"
            checked={status.enabled}
            disabled={busy}
            onChange={(e) => void act(() => host.setEnabled(e.target.checked))}
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
            {!status.listening ? (
              <p className="text-sm text-danger">{t.sync.notListening}</p>
            ) : status.addresses.length === 0 ? (
              <p className="text-sm text-danger">{t.sync.noNetwork}</p>
            ) : (
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
            )}
            <p className="text-xs text-fg-3">{t.sync.firewall}</p>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-xs text-fg-2">
                {status.lastSyncAt ? t.sync.lastSync(ago(status.lastSyncAt, t.locale)) : t.sync.never}
              </span>
              <button
                type="button"
                disabled={busy}
                onClick={() => void act(host.newCode)}
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
function ClientPanel({ client }: { client: NonNullable<typeof api.syncClient> }) {
  const t = useT();
  const status = useSyncExternalStore(client.subscribe, client.status) as SyncClientStatus;
  const [address, setAddress] = useState("");
  const [code, setCode] = useState("");
  const [pairing, setPairing] = useState(false);

  const errorText = (reason?: string) => (reason && reason in t.sync.errors ? t.sync.errors[reason as keyof typeof t.sync.errors] : undefined);

  const connect = async () => {
    setPairing(true);
    try {
      await client.pair(address, code);
      toast(t.sync.synced);
      setCode("");
    } catch (e) {
      toast(errorText((e as Error).message) ?? (e as Error).message, "error");
    } finally {
      setPairing(false);
    }
  };

  const input =
    "h-11 w-full rounded-full border border-line-strong bg-surface-2 px-4 text-[15px] placeholder:text-fg-3 focus:border-accent focus:outline-none";

  return (
    <section className="flex flex-col gap-3">
      <h3 className="flex items-center gap-1.5 text-xs font-medium text-fg-3">
        <DesktopIcon size={14} /> {t.sync.clientTitle}
      </h3>
      <div className={box}>
        {status.paired ? (
          <>
            <p className="text-sm font-medium">{t.sync.pairedWith(status.host ?? "")}</p>
            <p className="text-xs text-fg-2">
              {status.syncing ? t.sync.syncing : status.lastSyncAt ? t.sync.lastSync(ago(status.lastSyncAt, t.locale)) : t.sync.never}
            </p>
            {status.error && !status.syncing && <p className="text-sm text-danger">{errorText(status.error)}</p>}
            <div className="flex flex-wrap justify-end gap-2">
              <button type="button" onClick={() => client.unpair()} className={cn(button, "text-fg-2 hover:text-fg")}>
                {t.sync.unpair}
              </button>
              <button
                type="button"
                disabled={status.syncing}
                onClick={() =>
                  void client.syncNow().then(
                    () => toast(t.sync.synced),
                    () => {},
                  )
                }
                className={cn(button, "bg-accent text-accent-ink")}
              >
                <ArrowsClockwiseIcon size={16} className={cn(status.syncing && "animate-spin")} /> {t.sync.syncNow}
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
            <button type="submit" disabled={pairing || !address.trim() || !code.trim()} className={cn(button, "self-end bg-accent text-accent-ink")}>
              {pairing ? t.sync.pairing : t.sync.pair}
            </button>
          </form>
        )}
        <Secure />
      </div>
    </section>
  );
}

/** Settings → sync between the PC and the phone: the PC's panel on the desktop app, the phone's in the phone app. */
export function SyncSection() {
  if (api.syncClient) return <ClientPanel client={api.syncClient} />;
  if (api.syncHost) return <HostPanel host={api.syncHost} />;
  return null;
}
