import { appendFile, mkdir, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { config } from "./config.js";
import type { PlaysStorage } from "./plays.js";

export function playsFileStorage(dir = config.dataDir): PlaysStorage {
  const file = path.join(dir, "plays.jsonl");
  return {
    async read() {
      try {
        return await readFile(file, "utf8");
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
        throw error;
      }
    },
    async append(lines) {
      await mkdir(dir, { recursive: true });
      await appendFile(file, lines, "utf8");
    },
    async clear() {
      await rm(file, { force: true });
    },
  };
}
