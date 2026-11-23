import { create } from "zustand";

export const profileRanges = ["days7", "days30", "months6", "year", "all"] as const;
export type ProfileRange = (typeof profileRanges)[number];

interface Preferences {
  name: string;
  range: ProfileRange;
}

const KEY = "earful:profile";
const MAX_NAME = 60;

function read(): Preferences {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? "{}") as Partial<Preferences>;
    return {
      name: typeof saved.name === "string" ? saved.name.trim().slice(0, MAX_NAME) : "",
      range: saved.range && profileRanges.includes(saved.range) ? saved.range : "days30",
    };
  } catch {
    return { name: "", range: "days30" };
  }
}

function persist(prefs: Preferences) {
  try {
    localStorage.setItem(KEY, JSON.stringify(prefs));
  } catch {
    /* private mode */
  }
}

export const useProfile = create<Preferences & {
  setName: (name: string) => void;
  setRange: (range: ProfileRange) => void;
}>((set, get) => ({
  ...read(),
  setName: (name) => {
    const prefs = { name: name.trim().slice(0, MAX_NAME), range: get().range };
    set(prefs);
    persist(prefs);
  },
  setRange: (range) => {
    const prefs = { name: get().name, range };
    set(prefs);
    persist(prefs);
  },
}));
