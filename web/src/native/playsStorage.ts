import { Directory, Encoding, Filesystem } from "@capacitor/filesystem";
import type { PlaysStorage } from "../../../server/src/plays";

const file = { path: "plays.jsonl", directory: Directory.Data } as const;
const missing = (error: unknown) => (error as { code?: string })?.code === "OS-PLUG-FILE-0008" ||
  (error as { message?: string })?.message === "File does not exist.";

export const nativePlaysStorage: PlaysStorage = {
  async read() {
    try {
      const { data } = await Filesystem.readFile({ ...file, encoding: Encoding.UTF8 });
      return typeof data === "string" ? data : await data.text();
    } catch (error) {
      if (missing(error)) return null;
      throw error;
    }
  },
  async append(lines) {
    await Filesystem.appendFile({ ...file, data: lines, encoding: Encoding.UTF8 });
  },
  async clear() {
    try {
      await Filesystem.deleteFile(file);
    } catch (error) {
      if (!missing(error)) throw error;
    }
  },
};
