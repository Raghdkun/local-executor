import { join } from "node:path";
import type { FetchLike } from "./client.js";

export const OLLAMA_RELEASES_API = "https://api.github.com/repos/ollama/ollama/releases/latest";
export const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

interface ReleaseCache {
  tag: string;
  fetchedAt: number;
}

export interface ReleaseDeps {
  fetchImpl: FetchLike;
  readCache: () => Promise<ReleaseCache | null>;
  writeCache: (c: ReleaseCache) => Promise<void>;
  now: () => number;
}

export function releaseCachePath(cacheDir: string): string {
  return join(cacheDir, "ollama-release.json");
}

/** Latest Ollama release tag ("v0.33.3"), or null when offline. Never throws. */
export async function latestOllamaVersion(deps: ReleaseDeps): Promise<string | null> {
  const cached = await deps.readCache().catch(() => null);
  if (cached && deps.now() - cached.fetchedAt < CACHE_TTL_MS) return cached.tag;
  try {
    const res = await deps.fetchImpl(OLLAMA_RELEASES_API, {
      headers: { Accept: "application/vnd.github+json", "User-Agent": "local-executor" },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return cached?.tag ?? null;
    const data = (await res.json()) as { tag_name?: string };
    if (!data.tag_name) return cached?.tag ?? null;
    await deps.writeCache({ tag: data.tag_name, fetchedAt: deps.now() }).catch(() => undefined);
    return data.tag_name;
  } catch {
    return cached?.tag ?? null;
  }
}

/** Parse "v0.33.3", "0.33.3", "0.33.3-rc1" into numbers. Returns null when unparseable. */
export function parseVersion(v: string): [number, number, number] | null {
  const m = /^v?(\d+)\.(\d+)\.(\d+)/.exec(v.trim());
  if (!m) return null;
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

/** Negative when a < b, 0 when equal, positive when a > b. Null when either is unparseable. */
export function compareVersions(a: string, b: string): number | null {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  if (!pa || !pb) return null;
  for (let i = 0; i < 3; i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

export function isOutdated(installed: string, latest: string): boolean {
  const c = compareVersions(installed, latest);
  return c !== null && c < 0;
}
