import { describe, expect, it } from "vitest";
import { catalog, findModel, lastVerified, tiers } from "../../src/models/catalog.js";

describe("catalog", () => {
  it("has a lastVerified date in ISO format", () => {
    expect(lastVerified).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("has unique tags with positive sizes", () => {
    const tags = catalog.map((m) => m.tag);
    expect(new Set(tags).size).toBe(tags.length);
    for (const m of catalog) {
      expect(m.sizeGB).toBeGreaterThan(0);
      expect(m.contextK).toBeGreaterThan(0);
      expect(m.notes.length).toBeGreaterThan(10);
    }
  });

  it("every tier references tags that exist in the catalog", () => {
    for (const t of tiers) {
      expect(findModel(t.recommended), t.recommended).toBeDefined();
      for (const alt of t.alsoOffer) expect(findModel(alt), alt).toBeDefined();
    }
  });

  it("tiers are contiguous from 0 to Infinity", () => {
    expect(tiers[0]?.minGB).toBe(0);
    for (let i = 1; i < tiers.length; i++) {
      expect(tiers[i]?.minGB).toBe(tiers[i - 1]?.maxGB);
    }
    expect(tiers[tiers.length - 1]?.maxGB).toBe(Number.POSITIVE_INFINITY);
  });

  it("matches the documented tier table", () => {
    const byLabel = Object.fromEntries(tiers.map((t) => [t.label, t.recommended]));
    expect(byLabel).toEqual({
      "< 6 GB": "qwen3.5:2b",
      "6–10 GB": "qwen3.5:4b",
      "10–14 GB": "qwen3.5:9b",
      "14–22 GB": "qwen3.5:9b",
      "22–30 GB": "qwen3.8:27b",
      "30–48 GB": "qwen3.6:35b-a3b",
      "≥ 48 GB": "qwen3.6:35b-a3b",
    });
  });
});
