import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { config } from "./config.js";

export const cacheDaysOptions = [1, 3, 7, 14, 30, 90, 0] as const;
export type CacheDays = (typeof cacheDaysOptions)[number];
interface Settings {
  cacheDays: CacheDays;
  [key: string]: unknown;
}

const file = path.join(config.dataDir, "settings.json");

export function readJson<T>(file: string, fallback: T): T {
  try {
    return JSON.parse(readFileSync(file, "utf8")) as T;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return fallback;
    throw error;
  }
}

export function writeJson(file: string, value: unknown) {
  mkdirSync(path.dirname(file), { recursive: true });
  const temporary = file + ".tmp";
  writeFileSync(temporary, JSON.stringify(value));
  renameSync(temporary, file);
}

export function isCacheDays(value: unknown): value is CacheDays {
  return cacheDaysOptions.some((days) => days === value);
}

export function getSettings(): Settings {
  const stored = readJson<Partial<Settings>>(file, {});
  return { ...stored, cacheDays: isCacheDays(stored.cacheDays) ? stored.cacheDays : 7 };
}

export function updateSettings(patch: Partial<Settings>): Settings {
  const settings = { ...getSettings(), ...patch };
  writeJson(file, settings);
  return settings;
}
