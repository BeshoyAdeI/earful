import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { config } from "./config.js";

export interface ServerSettings {
  discord: boolean;
  [key: string]: unknown;
}

const file = path.join(config.dataDir, "settings.json");

export function getSettings(): ServerSettings {
  try {
    const stored = JSON.parse(readFileSync(file, "utf8")) as Partial<ServerSettings> | null;
    if (!stored || typeof stored !== "object" || Array.isArray(stored)) return { discord: true };
    return { ...stored, discord: typeof stored.discord === "boolean" ? stored.discord : true };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { discord: true };
    throw error;
  }
}

export function updateSettings(patch: Partial<ServerSettings>): ServerSettings {
  const settings = { ...getSettings(), ...patch };
  mkdirSync(config.dataDir, { recursive: true });
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temporary, JSON.stringify(settings, null, 2), { flag: "wx" });
    renameSync(temporary, file);
  } finally {
    rmSync(temporary, { force: true });
  }
  return settings;
}
