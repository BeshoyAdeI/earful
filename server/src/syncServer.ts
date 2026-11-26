import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { createServer, type IncomingMessage, type Server } from "node:http";
import { networkInterfaces } from "node:os";
import path from "node:path";
import { config } from "./config.js";
import { answerSync, keyFor, newPairingCode, SYNC_PATH, SYNC_PORT, SyncAuthError, type SyncCounts } from "./sync.js";

/**
 * The PC's end of phone sync (see sync.ts): its own small listener, separate from the app's server. It is off until
 * it's turned on in Settings, it listens on the network only while on, and it answers nothing but encrypted sync
 * messages, so the rest of Earful (which the desktop app keeps on this computer only) is never exposed.
 */

interface SyncSettings {
  enabled: boolean;
  code: string;
  lastSyncAt?: number;
}

const MAX_BODY = 50 * 1024 * 1024;
const file = () => path.join(config.dataDir, "sync.json");

let settings: SyncSettings | null = null;
let server: Server | null = null;
// Wrong-key messages from one address: after a burst, that address waits a minute.
const failures = new Map<string, { count: number; since: number }>();
const active = new Map<IncomingMessage, SyncActivity>();
const recent: SyncActivity[] = [];

function load(): SyncSettings {
  if (settings) return settings;
  try {
    const s = JSON.parse(readFileSync(file(), "utf8")) as Partial<SyncSettings>;
    settings = { enabled: s.enabled === true, code: typeof s.code === "string" ? s.code : newPairingCode(), lastSyncAt: s.lastSyncAt };
  } catch {
    settings = { enabled: false, code: newPairingCode() };
  }
  return settings;
}

function save() {
  mkdirSync(config.dataDir, { recursive: true });
  writeFileSync(file(), JSON.stringify(settings, null, 2));
}

/** This computer's addresses on the local network, for the phone to reach it. */
// Virtual adapters (WSL, Hyper-V, Docker, VirtualBox, VMware) a phone can't reach.
const VIRTUAL = /vEthernet|WSL|Hyper-V|docker|VirtualBox|VMware|vboxnet|veth|br-/i;

function addresses(): string[] {
  return Object.entries(networkInterfaces())
    .filter(([name]) => !VIRTUAL.test(name))
    .flatMap(([, list]) => list ?? [])
    .filter((i) => i.family === "IPv4" && !i.internal && !i.address.startsWith("169.254."))
    .map((i) => `${i.address}:${SYNC_PORT}`);
}

export interface SyncActivity {
  phase: "receiving" | "merging" | "sending" | "done" | "failed";
  at: number;
  from?: string;
  added?: SyncCounts;
  error?: "wrong code" | "invalid request" | "request too large" | "connection closed" | "sync failed";
}

export interface SyncStatus {
  enabled: boolean;
  /** Listening right now (false when on but the port couldn't be opened). */
  listening: boolean;
  code: string;
  addresses: string[];
  lastSyncAt?: number;
  syncing: boolean;
  activity?: SyncActivity;
  recent: SyncActivity[];
}

export function syncStatus(): SyncStatus {
  const s = load();
  let activity = recent[0];
  for (const request of active.values()) activity = request;
  return {
    enabled: s.enabled, listening: !!server?.listening, code: s.code, addresses: addresses(), lastSyncAt: s.lastSyncAt,
    syncing: active.size > 0, activity, recent: recent.slice(),
  };
}

function tooManyFailures(ip: string): boolean {
  const f = failures.get(ip);
  if (!f) return false;
  if (Date.now() - f.since > 60_000) {
    failures.delete(ip);
    return false;
  }
  return f.count >= 20;
}

function noteFailure(ip: string) {
  const f = failures.get(ip);
  if (!f || Date.now() - f.since > 60_000) failures.set(ip, { count: 1, since: Date.now() });
  else f.count++;
}

async function start(): Promise<void> {
  if (server) return;
  const s = createServer((req, res) => {
    const ip = req.socket.remoteAddress ?? "";
    const reply = (status: number, body?: unknown) => {
      res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
      res.end(body === undefined ? "" : JSON.stringify(body));
    };
    if (req.method !== "POST" || req.url !== SYNC_PATH) return reply(404);
    if (tooManyFailures(ip)) return reply(429);
    const from = ip || undefined;
    const setPhase = (phase: SyncActivity["phase"]) => {
      active.delete(req);
      active.set(req, { phase, at: Date.now(), from });
    };
    const finish = (result?: Pick<SyncActivity, "phase" | "error" | "added">) => {
      if (!active.delete(req) || !result) return;
      recent.unshift({ ...result, at: Date.now(), from });
      if (recent.length > 10) recent.pop();
    };
    setPhase("receiving");
    res.once("close", () => finish({ phase: "failed", error: "connection closed" }));
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        finish({ phase: "failed", error: "request too large" });
        reply(413);
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", async () => {
      if (res.writableEnded) return;
      try {
        const envelope = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        const answer = await answerSync(await keyFor(load().code), envelope, (phase) => {
          if (active.has(req)) setPhase(phase);
        });
        if (!active.has(req)) return;
        if (answer.added) {
          settings!.lastSyncAt = Date.now();
          save();
          res.once("finish", () => finish({ phase: "done", added: answer.added }));
        } else {
          finish(); // Discovery pings do not enter sync history.
        }
        reply(200, answer.envelope);
      } catch (error) {
        if (error instanceof SyncAuthError || error instanceof SyntaxError) {
          noteFailure(ip);
          finish({ phase: "failed", error: error.message === "wrong key" ? "wrong code" : "invalid request" });
          if (!res.destroyed) reply(403);
          return;
        }
        finish({ phase: "failed", error: "sync failed" });
        if (!res.destroyed) reply(500);
      }
    });
  });
  await new Promise<void>((resolve, reject) => {
    s.once("error", reject);
    s.listen(SYNC_PORT, "0.0.0.0", () => resolve());
  });
  server = s;
}

async function stop(): Promise<void> {
  const s = server;
  server = null;
  if (s) await new Promise<void>((resolve) => s.close(() => resolve()));
}

/** Starts listening if sync is on (at startup). A port already in use is reported in the status, not thrown. */
export async function startSyncIfEnabled(): Promise<void> {
  if (load().enabled) await start().catch(() => {});
}

export async function setSyncEnabled(enabled: boolean): Promise<SyncStatus> {
  load().enabled = enabled;
  save();
  if (enabled) await start().catch(() => {});
  else await stop();
  return syncStatus();
}

/** A new pairing code: the phone paired with the old one can no longer sync. */
export function newSyncCode(): SyncStatus {
  load().code = newPairingCode();
  save();
  return syncStatus();
}
