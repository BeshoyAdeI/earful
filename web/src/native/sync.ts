import { App } from "@capacitor/app";
import { CapacitorHttp } from "@capacitor/core";
import { getLibrary, syncLibrary } from "../../../server/src/library";
import { mergePlays, playsSince } from "../../../server/src/plays";
import { keyFor, normalizeCode, seal, SYNC_PATH, SYNC_PORT, unseal, type SyncRequest, type SyncResponse } from "../../../server/src/sync";
import type { SyncClientStatus } from "../lib/apiTypes";

/**
 * The phone's end of sync with the PC (server/src/sync.ts has the protocol): sends this library and its recent plays,
 * merges back what the PC answers. Runs when the app opens, when it comes back to the front, and every 15 minutes
 * while it's open, plus "Sync now" in Settings. When the PC can't be reached at its last address (its address
 * changed), the app looks for it on the same network.
 *
 * Requests go through Android's HTTP stack (Capacitor), not the WebView's fetch: the PC is a plain-HTTP address on
 * the local network, which a page can't call. Every message is still encrypted with the pairing code.
 */

const STORE = "earful:sync";
const AUTO_EVERY_MS = 15 * 60_000;
const SEARCH_EVERY_MS = 30 * 60_000;
/** Plays from a little before the last sync are exchanged again: duplicates are dropped on both sides. */
const OVERLAP_MS = 15 * 60_000;

interface Paired {
  host: string;
  code: string;
  lastSyncAt?: number;
}

let paired: Paired | null = read();
let syncing: Promise<void> | null = null;
let lastError: SyncClientStatus["error"];
let lastSearch = 0;
const listeners = new Set<() => void>();

function read(): Paired | null {
  try {
    const p = JSON.parse(localStorage.getItem(STORE) ?? "null") as Paired | null;
    return p && typeof p.host === "string" && typeof p.code === "string" ? p : null;
  } catch {
    return null;
  }
}

function write() {
  try {
    if (paired) localStorage.setItem(STORE, JSON.stringify(paired));
    else localStorage.removeItem(STORE);
  } catch {
    /* storage unavailable: stays paired for this session */
  }
  notify();
}

let snapshot: SyncClientStatus | null = null;

/** The current status; the same object until something changes (React's useSyncExternalStore needs that). */
export function syncStatus(): SyncClientStatus {
  return (snapshot ??= { paired: !!paired, host: paired?.host, lastSyncAt: paired?.lastSyncAt, syncing: !!syncing, error: lastError });
}

function notify() {
  snapshot = null;
  listeners.forEach((l) => l());
}

export function onSyncChange(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** "192.168.1.5", "192.168.1.5:4281" or a pasted "http://…/" → "192.168.1.5:4281". */
function hostOf(input: string): string | null {
  const m = /^(?:https?:\/\/)?(\d{1,3}(?:\.\d{1,3}){3}|[a-z0-9.-]+)(?::(\d{1,5}))?\/?$/i.exec(input.trim());
  return m ? `${m[1]}:${m[2] ?? SYNC_PORT}` : null;
}

class SyncError extends Error {
  constructor(readonly reason: NonNullable<SyncClientStatus["error"]>) {
    super(reason);
  }
}

async function post(host: string, envelope: unknown, timeoutMs: number): Promise<unknown> {
  let res;
  try {
    res = await CapacitorHttp.post({
      url: `http://${host}${SYNC_PATH}`,
      headers: { "content-type": "application/json" },
      data: envelope,
      connectTimeout: timeoutMs,
      readTimeout: 120_000,
    });
  } catch {
    throw new SyncError("unreachable");
  }
  if (res.status === 403 || res.status === 429) throw new SyncError("wrongCode");
  if (res.status !== 200) throw new SyncError("unreachable");
  return typeof res.data === "string" ? JSON.parse(res.data) : res.data;
}

async function exchange(host: string, code: string, since: number): Promise<void> {
  const key = await keyFor(code);
  const request: SyncRequest = { kind: "sync", t: Date.now(), since, library: await getLibrary(), plays: await playsSince(since) };
  let answer: SyncResponse;
  try {
    answer = await unseal<SyncResponse>(key, await post(host, await seal(key, request), 4000));
  } catch (error) {
    if (error instanceof SyncError) throw error;
    throw new SyncError("wrongCode");
  }
  await syncLibrary(answer.library);
  await mergePlays(answer.plays);
}

/** Asks every address on the same network as `host` whether it's the paired PC; the first one that answers wins. */
async function findPc(host: string, code: string): Promise<string | null> {
  const m = /^(\d+\.\d+\.\d+)\.\d+:(\d+)$/.exec(host);
  if (!m) return null;
  const key = await keyFor(code);
  const ping = await seal(key, { kind: "ping", t: Date.now() });
  const candidates = Array.from({ length: 254 }, (_, i) => `${m[1]}.${i + 1}:${m[2]}`).filter((h) => h !== host);
  for (let i = 0; i < candidates.length; i += 32) {
    const found = await Promise.any(
      candidates.slice(i, i + 32).map(async (h) => {
        const pong = await unseal<{ kind: string; t: number }>(key, await post(h, ping, 1200));
        if (pong.kind !== "pong") throw new Error("not it");
        return h;
      }),
    ).catch(() => null);
    if (found) return found;
  }
  return null;
}

async function reloadScreens() {
  const { useLibrary } = await import("../stores/library");
  await useLibrary.getState().load();
}

async function run(manual: boolean): Promise<void> {
  const p = paired;
  if (!p) return;
  const startedAt = Date.now();
  const since = p.lastSyncAt ? p.lastSyncAt - OVERLAP_MS : 0;
  try {
    try {
      await exchange(p.host, p.code, since);
    } catch (error) {
      // The PC isn't at its last address: look for it on this network (not too often when nobody asked).
      if (!(error instanceof SyncError) || error.reason !== "unreachable") throw error;
      if (!manual && Date.now() - lastSearch < SEARCH_EVERY_MS) throw error;
      lastSearch = Date.now();
      const moved = await findPc(p.host, p.code);
      if (!moved) throw error;
      p.host = moved;
      await exchange(p.host, p.code, since);
    }
    p.lastSyncAt = startedAt;
    lastError = undefined;
    write();
    await reloadScreens();
  } catch (error) {
    lastError = error instanceof SyncError ? error.reason : "unreachable";
    notify();
    throw error;
  }
}

/** Syncs now. `manual`: from the Sync now button (errors are thrown for it to show). */
export function syncNow(manual = false): Promise<void> {
  syncing ??= run(manual).finally(() => {
    syncing = null;
    notify();
  });
  notify();
  return syncing;
}

/** Pairs with the PC at `address` using its code, and syncs once to check both. */
export async function pair(address: string, code: string): Promise<SyncClientStatus> {
  const host = hostOf(address);
  if (!host) throw new SyncError("badAddress");
  const clean = normalizeCode(code);
  if (!clean) throw new SyncError("badCode");
  const before = paired;
  paired = { host, code: clean };
  try {
    await syncNow(true);
  } catch (error) {
    paired = before;
    write();
    throw error;
  }
  return syncStatus();
}

export function unpair(): SyncClientStatus {
  paired = null;
  lastError = undefined;
  write();
  return syncStatus();
}

// Automatic syncs: shortly after launch, on coming back to the front, and every 15 minutes while open.
setTimeout(() => void syncNow().catch(() => {}), 5000);
void App.addListener("resume", () => void syncNow().catch(() => {}));
setInterval(() => {
  if (document.visibilityState === "visible") void syncNow().catch(() => {});
}, AUTO_EVERY_MS);
