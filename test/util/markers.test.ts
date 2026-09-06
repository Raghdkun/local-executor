import { describe, expect, it } from "vitest";
import {
  extractBlock,
  hasBlock,
  removeBlock,
  upsertBlock,
  wrapBlock,
} from "../../src/util/markers.js";

describe("markers", () => {
  it("appends a block to an empty file", () => {
    const out = upsertBlock("", "hello");
    expect(out).toBe("<!-- lex:start -->\nhello\n<!-- lex:end -->\n");
    expect(hasBlock(out)).toBe(true);
  });

  it("appends after a blank line when content exists", () => {
    const out = upsertBlock("# My rules\n", "hello");
    expect(out).toBe("# My rules\n\n<!-- lex:start -->\nhello\n<!-- lex:end -->\n");
  });

  it("replaces an existing block in place without touching surroundings", () => {
    const original = "# top\n\n<!-- lex:start -->\nold\n<!-- lex:end -->\n\n# bottom\n";
    const out = upsertBlock(original, "new body");
    expect(out).toBe("# top\n\n<!-- lex:start -->\nnew body\n<!-- lex:end -->\n\n# bottom\n");
    expect(extractBlock(out)).toBe("new body");
  });

  it("is idempotent", () => {
    const once = upsertBlock("x\n", "body");
    expect(upsertBlock(once, "body")).toBe(once);
  });

  it("removes the block and leaves other content", () => {
    const withBlock = upsertBlock("# top\n", "body");
    expect(removeBlock(withBlock)).toBe("# top\n");
    expect(removeBlock("no block here\n")).toBe("no block here\n");
  });

  it("removes a block that sits between other sections", () => {
    const s = "# a\n\n<!-- lex:start -->\nb\n<!-- lex:end -->\n\n# c\n";
    expect(removeBlock(s)).toBe("# a\n\n# c\n");
  });

  it("supports custom markers", () => {
    const m = { start: "// lex:start", end: "// lex:end" };
    const out = upsertBlock("", "body", m);
    expect(wrapBlock("body", m)).toBe(out);
    expect(hasBlock(out)).toBe(false);
    expect(hasBlock(out, m)).toBe(true);
  });
});
