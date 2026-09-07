import { describe, expect, it } from "vitest";
import { pickFallback } from "../../src/steps/skills.js";

const list = [
  { tag: "qwen3.5:9b", sizeGB: 6.6, fitsMemory: true },
  { tag: "gemma4:e4b", sizeGB: 9.6, fitsMemory: true },
  { tag: "qwen3.5:4b", sizeGB: 3.4, fitsMemory: true },
  { tag: "gemma4:e2b", sizeGB: 7.2, fitsMemory: true },
  { tag: "qwen3.5:2b", sizeGB: 2.7, fitsMemory: true },
];

describe("pickFallback", () => {
  it("prefers the largest smaller model in the same family", () => {
    expect(pickFallback(list, "qwen3.5:9b", 6.6)).toBe("qwen3.5:4b");
  });
  it("falls back to any smaller fitting model", () => {
    expect(pickFallback(list, "gemma4:e4b", 9.6)).toBe("gemma4:e2b");
    expect(
      pickFallback(
        list.filter((r) => !r.tag.startsWith("gemma")),
        "gemma4:e4b",
        9.6,
      ),
    ).toBe("qwen3.5:4b");
  });
  it("returns null when nothing meaningfully smaller exists or size is unknown", () => {
    expect(pickFallback(list, "qwen3.5:2b", 2.7)).toBeNull();
    expect(pickFallback(list, "custom:1", undefined)).toBeNull();
  });
});
