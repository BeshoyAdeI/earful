/** Covers are the only remote resources the image endpoint may request. */
export function coverUrl(value: unknown): URL | null {
  if (typeof value !== "string" || value.length > 2048) return null;
  try {
    const url = new URL(value);
    const host = url.hostname;
    if (url.protocol === "https:" && !url.port && !url.username && !url.password &&
      (host === "i.ytimg.com" || host.endsWith(".googleusercontent.com") || host.endsWith(".ggpht.com"))) return url;
  } catch {
    // Malformed URLs are outside the allowlist.
  }
  return null;
}

export const MAX_COVER_BYTES = 5 * 1024 * 1024;

export function isCoverType(type: string): boolean {
  return /^image\/(?:jpeg|png|webp|gif|avif|bmp)(?:\s*;|$)/i.test(type);
}
