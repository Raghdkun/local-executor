import { describe, expect, it } from "vitest";
import { lastVerified } from "../../src/models/catalog.js";
import {
  catalogAgeDays,
  diffFamily,
  isBaseTag,
  parseLibraryList,
  parseTagsPage,
  refreshCatalog,
  summarizeRefresh,
} from "../../src/models/refresh.js";

const tagsHtml = `
<html><body>
<a href="/library/qwen3.5:9b"><span>qwen3.5:9b</span></a><span>latest</span> <span>6488c96fa5fa</span> • <span>6.6GB</span> • <span>256K context window</span> • Text • <span>6 months ago</span>
<a href="/library/qwen3.5:9b-q8_0">qwen3.5:9b-q8_0</a> • 9.8GB • 256K context window • 6 months ago
<a href="/library/qwen3.5:14b">qwen3.5:14b</a> • 9.9GB • 256K context window • 2 days ago
<a href="/library/qwen3.5:4b">qwen3.5:4b</a> • 3.4GB • 256K context window • 6 months ago
<a href="/library/qwen3.5:2b">qwen3.5:2b</a> • 2.7GB • 256K context window • 6 months ago
<a href="/library/qwen3.5:9b-mlx">qwen3.5:9b-mlx</a> • 8.9GB • 256K context window • 3 months ago
<a href="/library/qwen3.5:tiny">qwen3.5:tiny</a> • 700MB • 32K context window • 1 week ago
</body></html>`;

describe("parseTagsPage", () => {
  it("extracts tags, sizes, context, and age", () => {
    const tags = parseTagsPage(tagsHtml, "qwen3.5");
    const by = Object.fromEntries(tags.map((t) => [t.tag, t]));
    expect(by["qwen3.5:9b"]).toMatchObject({ sizeGB: 6.6, contextK: 256, updated: "6 months ago" });
    expect(by["qwen3.5:14b"]).toMatchObject({ sizeGB: 9.9, updated: "2 days ago" });
    expect(by["qwen3.5:tiny"]?.sizeGB).toBe(0.7);
    expect(tags.map((t) => t.tag)).not.toContain("qwen3.5:9b:latest");
  });
});

describe("isBaseTag", () => {
  it("keeps plain size tags and drops quantization/format variants", () => {
    expect(isBaseTag("qwen3.5:14b")).toBe(true);
    expect(isBaseTag("qwen3.5:9b-q8_0")).toBe(false);
    expect(isBaseTag("qwen3.5:9b-mlx")).toBe(false);
    expect(isBaseTag("gemma4:26b-a4b-it-q4_K_M")).toBe(false);
    expect(isBaseTag("qwen3.5:latest")).toBe(false);
    expect(isBaseTag("qwen3.5:cloud")).toBe(false);
    expect(isBaseTag("qwen3.6:35b-a3b-coding")).toBe(true);
  });
});

describe("diffFamily", () => {
  it("reports missing, size drift, and new base tags", () => {
    const remote = parseTagsPage(tagsHtml, "qwen3.5");
    const d = diffFamily("qwen3.5", remote);
    // qwen3.5:9b-mlx is in the catalog and on the page; 2b/4b/9b present too.
    expect(d.missing).toEqual([]);
    expect(d.sizeChanged).toEqual([]);
    expect(d.newTags.map((t) => t.tag)).toEqual(["qwen3.5:14b", "qwen3.5:tiny"]);
  });

  it("flags catalog tags that vanished and sizes that changed", () => {
    const remote = [{ tag: "qwen3.5:9b", sizeGB: 8.0, contextK: 256, updated: null }];
    const d = diffFamily("qwen3.5", remote);
    expect(d.missing).toEqual(
      expect.arrayContaining(["qwen3.5:2b", "qwen3.5:4b", "qwen3.5:9b-mlx"]),
    );
    expect(d.sizeChanged).toEqual([{ tag: "qwen3.5:9b", catalogGB: 6.6, remoteGB: 8 }]);
  });
});

describe("parseLibraryList", () => {
  it("returns unique model names in page order", () => {
    const html = `<a href="/library/qwen3.7">x</a><a href="/library/gemma4">y</a><a href="/library/qwen3.7">z</a><a href="/library/nomic-embed-text">e</a>`;
    expect(parseLibraryList(html)).toEqual(["qwen3.7", "gemma4", "nomic-embed-text"]);
  });
});

describe("refreshCatalog", () => {
  it("fails soft per family and summarizes", async () => {
    const fetchImpl = async (url: string): Promise<Response> => {
      if (url.endsWith("/qwen3.5/tags")) return new Response(tagsHtml, { status: 200 });
      if (url.includes("sort=newest"))
        return new Response(
          `<a href="/library/qwen3.7">a</a><a href="/library/codestral-next">b</a><a href="/library/bge-m3">c</a><a href="/library/gemma4">d</a>`,
          { status: 200 },
        );
      return new Response("nope", { status: 503 });
    };
    const later = new Date(new Date(lastVerified).getTime() + 30 * 86_400_000);
    const r = await refreshCatalog(fetchImpl, later);
    expect(r.catalogAgeDays).toBe(30);
    expect(r.newFamilies).toEqual(["qwen3.7", "codestral-next"]);
    expect(r.errors.length).toBeGreaterThan(0);
    const text = summarizeRefresh(r).join("\n");
    expect(text).toMatch(/qwen3.5:14b/);
    expect(text).toMatch(/Newest coding-capable families.*qwen3.7/);
    expect(text).toMatch(/Could not check/);
  });

  it("says the catalog matches when nothing differs", async () => {
    const empty = {
      checkedAt: "2026-09-07T00:00:00Z",
      lastVerified: "2026-09-06",
      catalogAgeDays: 1,
      families: [{ family: "qwen3.5" as const, missing: [], sizeChanged: [], newTags: [] }],
      newFamilies: [],
      errors: [],
    };
    expect(summarizeRefresh(empty).join("\n")).toMatch(/matches ollama.com/);
  });

  it("catalogAgeDays counts from lastVerified", () => {
    const base = new Date(lastVerified).getTime();
    expect(catalogAgeDays(new Date(base + 12 * 3_600_000))).toBe(0);
    expect(catalogAgeDays(new Date(base + 60 * 86_400_000 + 3_600_000))).toBe(60);
  });
});
