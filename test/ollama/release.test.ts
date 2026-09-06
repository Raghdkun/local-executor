import { describe, expect, it, vi } from "vitest";
import {
  compareVersions,
  isOutdated,
  latestOllamaVersion,
  parseVersion,
} from "../../src/ollama/release.js";

describe("versions", () => {
  it("parses tags with and without v", () => {
    expect(parseVersion("v0.33.3")).toEqual([0, 33, 3]);
    expect(parseVersion("0.33.3-rc1")).toEqual([0, 33, 3]);
    expect(parseVersion("garbage")).toBeNull();
  });
  it("compares", () => {
    expect(compareVersions("0.33.2", "v0.33.3")).toBeLessThan(0);
    expect(compareVersions("0.34.0", "0.33.9")).toBeGreaterThan(0);
    expect(compareVersions("1.0.0", "1.0.0")).toBe(0);
    expect(compareVersions("x", "1.0.0")).toBeNull();
    expect(isOutdated("0.33.2", "v0.33.3")).toBe(true);
    expect(isOutdated("0.33.3", "v0.33.3")).toBe(false);
    expect(isOutdated("weird", "v0.33.3")).toBe(false);
  });
});

describe("latestOllamaVersion", () => {
  it("uses a fresh cache without fetching", async () => {
    const fetchImpl = vi.fn();
    const v = await latestOllamaVersion({
      fetchImpl,
      readCache: async () => ({ tag: "v0.33.3", fetchedAt: 1000 }),
      writeCache: async () => undefined,
      now: () => 2000,
    });
    expect(v).toBe("v0.33.3");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("fetches when the cache is stale and writes the cache", async () => {
    const writeCache = vi.fn(async () => undefined);
    const v = await latestOllamaVersion({
      fetchImpl: async () => new Response(JSON.stringify({ tag_name: "v0.34.0" }), { status: 200 }),
      readCache: async () => ({ tag: "v0.33.3", fetchedAt: 0 }),
      writeCache,
      now: () => 48 * 3600 * 1000,
    });
    expect(v).toBe("v0.34.0");
    expect(writeCache).toHaveBeenCalledWith({ tag: "v0.34.0", fetchedAt: 48 * 3600 * 1000 });
  });

  it("fails soft when offline, preferring a stale cache", async () => {
    const offline = async (): Promise<Response> => {
      throw new Error("offline");
    };
    expect(
      await latestOllamaVersion({
        fetchImpl: offline,
        readCache: async () => ({ tag: "v0.30.0", fetchedAt: 0 }),
        writeCache: async () => undefined,
        now: () => 10 ** 12,
      }),
    ).toBe("v0.30.0");
    expect(
      await latestOllamaVersion({
        fetchImpl: offline,
        readCache: async () => null,
        writeCache: async () => undefined,
        now: () => 0,
      }),
    ).toBeNull();
  });

  it("returns cached tag on HTTP errors such as rate limiting", async () => {
    const v = await latestOllamaVersion({
      fetchImpl: async () => new Response("rate limited", { status: 403 }),
      readCache: async () => ({ tag: "v0.31.0", fetchedAt: 0 }),
      writeCache: async () => undefined,
      now: () => 10 ** 12,
    });
    expect(v).toBe("v0.31.0");
  });
});
