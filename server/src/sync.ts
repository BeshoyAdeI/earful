import { mergePlays, playsSince } from "./plays.js";
import { syncLibrary } from "./library.js";
import type { Library } from "./types.js";
import type { PlayEvent } from "./plays.js";

/**
 * Sync between the phone and the PC on the same Wi-Fi: favorites, playlists, recently played and listening stats.
 *
 * The phone sends its library and its recent plays; the PC merges them into its own and answers with the merged
 * library and its recent plays; the phone merges those. Merging is idempotent, so a repeated or interrupted sync
 * does no harm.
 *
 * Safe on public networks: every message is encrypted and authenticated with AES-256-GCM, under a key derived from
 * the pairing code shown on the PC (16 random characters, about 78 bits). Someone on the same network sees only noise and
 * can't send or answer a sync without the code. A new code on the PC unpairs the old phone.
 *
 * No Node-only imports: the Android app runs this module too (it's the side that starts a sync).
 */

export const SYNC_PORT = 4281;
export const SYNC_PATH = "/earful-sync";

/** Crockford-style alphabet: no 0/O or 1/I/L to mix up when typing. */
const ALPHABET = "ABCDEFGHJKMNPQRSTVWXYZ23456789";
const CODE_LENGTH = 16;
/** Messages older (or newer) than this are refused: an old recorded message can't be replayed later. */
const MAX_AGE_MS = 24 * 3600_000;

export function newPairingCode(): string {
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(CODE_LENGTH));
  // 30 letters: reject bytes that would bias the pick.
  let code = "";
  let i = 0;
  while (code.length < CODE_LENGTH) {
    if (i >= bytes.length) {
      globalThis.crypto.getRandomValues(bytes);
      i = 0;
    }
    const b = bytes[i++]!;
    if (b < 240) code += ALPHABET[b % ALPHABET.length];
  }
  return formatCode(code);
}

/** "abcd efgh-jkmn pqrs" → "ABCD-EFGH-JKMN-PQRS", or null when it can't be a pairing code. */
export function normalizeCode(input: string): string | null {
  const raw = input.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (raw.length !== CODE_LENGTH || [...raw].some((c) => !ALPHABET.includes(c))) return null;
  return formatCode(raw);
}

const formatCode = (raw: string) => raw.match(/.{4}/g)!.join("-");

const toBase64 = (bytes: Uint8Array) => {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
};
const fromBase64 = (b64: string) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));

const keys = new Map<string, Promise<CryptoKey>>();

/** The AES key for a pairing code: PBKDF2 with many rounds, so trying codes from a recorded message is slow. */
export function keyFor(code: string): Promise<CryptoKey> {
  let key = keys.get(code);
  if (!key) {
    key = (async () => {
      const subtle = globalThis.crypto.subtle;
      const base = await subtle.importKey("raw", new TextEncoder().encode(code), "PBKDF2", false, ["deriveKey"]);
      return subtle.deriveKey(
        { name: "PBKDF2", hash: "SHA-256", salt: new TextEncoder().encode("earful-sync-v1"), iterations: 310_000 },
        base,
        { name: "AES-GCM", length: 256 },
        false,
        ["encrypt", "decrypt"],
      );
    })();
    keys.set(code, key);
  }
  return key;
}

export interface Envelope {
  v: 1;
  iv: string;
  data: string;
}

export async function seal(key: CryptoKey, message: unknown): Promise<Envelope> {
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
  const plain = new TextEncoder().encode(JSON.stringify(message));
  const data = new Uint8Array(await globalThis.crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, plain));
  return { v: 1, iv: toBase64(iv), data: toBase64(data) };
}

export class SyncAuthError extends Error {}

/** Decrypts and checks a message; throws SyncAuthError when it wasn't sealed with this key or is too old. */
export async function unseal<T extends { t: number }>(key: CryptoKey, envelope: unknown): Promise<T> {
  const e = (envelope ?? {}) as Partial<Envelope>;
  if (e.v !== 1 || typeof e.iv !== "string" || typeof e.data !== "string") throw new SyncAuthError("bad envelope");
  let message: T;
  try {
    const plain = await globalThis.crypto.subtle.decrypt({ name: "AES-GCM", iv: fromBase64(e.iv) }, key, fromBase64(e.data));
    message = JSON.parse(new TextDecoder().decode(plain)) as T;
  } catch {
    throw new SyncAuthError("wrong key");
  }
  if (typeof message?.t !== "number" || Math.abs(Date.now() - message.t) > MAX_AGE_MS) throw new SyncAuthError("stale");
  return message;
}

/** A check that a paired PC answers at an address, without sending the library (finding the PC again). */
export interface SyncPing {
  kind: "ping";
  t: number;
}

export interface SyncRequest {
  kind: "sync";
  t: number;
  /** Plays started from this time on are wanted back (the last sync, minus a margin). */
  since: number;
  library: Library;
  plays: PlayEvent[];
}

export interface SyncResponse {
  kind: "synced";
  t: number;
  library: Library;
  plays: PlayEvent[];
}

/** The PC's side: merges what the phone sent and answers with the merged library and the plays it lacks. */
export async function answerSync(key: CryptoKey, envelope: unknown): Promise<Envelope> {
  const request = await unseal<SyncRequest | SyncPing>(key, envelope);
  if (request.kind === "ping") return seal(key, { kind: "pong", t: Date.now() });
  if (request.kind !== "sync") throw new SyncAuthError("wrong kind");
  const library = await syncLibrary(request.library);
  await mergePlays(request.plays);
  const since = typeof request.since === "number" && Number.isFinite(request.since) ? request.since : 0;
  const response: SyncResponse = { kind: "synced", t: Date.now(), library, plays: await playsSince(since) };
  return seal(key, response);
}

/**
 * What the PC's pairing QR code holds: every address it can be reached at, and the code.
 * "earful-sync:?h=192.168.1.5:4281,10.0.0.7:4281&c=ABCD-EFGH-JKMN-PQRS"
 */
export function pairingLink(addresses: string[], code: string): string {
  return `earful-sync:?h=${addresses.join(",")}&c=${code}`;
}

/** Reads a scanned pairing QR code; null when it's some other QR code. */
export function parsePairingLink(text: string): { hosts: string[]; code: string } | null {
  const m = /^earful-sync:\?(.*)$/i.exec(text.trim());
  if (!m) return null;
  const params = new URLSearchParams(m[1]);
  const code = normalizeCode(params.get("c") ?? "");
  const hosts = (params.get("h") ?? "").split(",").map((h) => h.trim()).filter((h) => /^[\w.-]+:\d{1,5}$/.test(h)).slice(0, 8);
  return code && hosts.length ? { hosts, code } : null;
}
