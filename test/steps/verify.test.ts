import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { VERIFY_PACKET, VERIFY_TEST } from "../../src/steps/verify.js";
import { run } from "../../src/util/exec.js";

describe("verify packet", () => {
  it("follows the handoff template sections", () => {
    for (const section of [
      "## Goal (required)",
      "## Files you may change (required)",
      "## Conventions (required)",
      "## Tests that must pass (required)",
      "## Do NOT",
    ]) {
      expect(VERIFY_PACKET).toContain(section);
    }
    expect(VERIFY_PACKET).toContain("Modern practices");
    expect(VERIFY_PACKET).toContain(VERIFY_TEST);
  });

  it("its test passes against a correct answer.mjs using node --test", async () => {
    const dir = await mkdtemp(join(tmpdir(), "lex-vt-"));
    await writeFile(join(dir, "answer.test.mjs"), VERIFY_TEST);
    await writeFile(join(dir, "answer.mjs"), "export const fortyTwo = () => 42;\n");
    const r = await run(process.execPath, ["--test", "answer.test.mjs"], {
      cwd: dir,
      timeoutMs: 60_000,
    });
    expect(r.ok).toBe(true);
  });
});
