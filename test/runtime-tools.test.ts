import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  appendStubs,
  detectFramework,
  parseMissingTests,
  renderStub,
} from "../skill/runtime/add_test_stubs.mjs";
import {
  changeableFiles,
  existingBlocks,
  lintPacket,
  sections,
} from "../skill/runtime/check_packet.mjs";
import { appendEvent, buildEvent, parseArgs } from "../skill/runtime/record_result.mjs";
import { attemptNumber, authHeaders } from "../skill/runtime/run_executor.mjs";
import { VERIFY_PACKET } from "../src/steps/verify.js";

const goodPacket = `# Task: Add helper

## Goal (required)
Add a helper that returns 42.

## Files you may change (required)
- src/a.mjs — add the helper

You may NOT change any other file.

## Conventions (required)
- Language/version: JavaScript, Node 20, ESM
- Modern practices:
  - ESM export
  - const only

## Existing code (required if the file exists)
### src/a.mjs
\`\`\`js
export const b = 1;
export const c = 2;
\`\`\`

## Tests that must pass (required)
Command: \`node --test test/a.test.mjs\`

### test/a.test.mjs
\`\`\`js
import { test } from "node:test";
test("x", () => {});
\`\`\`

## Do NOT
- Do not change tests
- Do not add files
`;

describe("check_packet", () => {
  it("accepts a good packet and the verify packet", () => {
    const r = lintPacket(goodPacket) as { errors: string[]; warnings: string[] };
    expect(r.errors).toEqual([]);
    const v = lintPacket(VERIFY_PACKET) as { errors: string[] };
    expect(v.errors).toEqual([]);
  });

  it("parses sections, changeable files, and existing blocks", () => {
    const sec = sections(goodPacket) as Map<string, string>;
    expect([...sec.keys()]).toEqual([
      "Goal",
      "Files you may change",
      "Conventions",
      "Existing code",
      "Tests that must pass",
      "Do NOT",
    ]);
    expect(changeableFiles(sec.get("Files you may change") ?? "")).toEqual([
      { path: "src/a.mjs", isNew: false },
    ]);
    expect(changeableFiles("- new.ts — create this file")).toEqual([
      { path: "new.ts", isNew: true },
    ]);
    expect([
      ...(existingBlocks(sec.get("Existing code") ?? "") as Map<string, number>).keys(),
    ]).toEqual(["src/a.mjs"]);
  });

  it("flags missing sections, placeholders, missing existing code, and retry without numbered fixes", () => {
    const bad = goodPacket
      .replace("## Do NOT\n- Do not change tests\n- Do not add files\n", "")
      .replace("### src/a.mjs\n```js\nexport const b = 1;\nexport const c = 2;\n```", "")
      .replace("Add a helper that returns 42.", "<2–4 sentences>")
      .concat(
        "\n## Previous attempt failed (only on retry)\nAttempt 1 produced this test output:\n```\nboom\n```\n",
      );
    const r = lintPacket(bad) as { errors: string[] };
    const text = r.errors.join("\n");
    expect(text).toMatch(/Missing section "## Do NOT"/);
    expect(text).toMatch(/placeholders/);
    expect(text).toMatch(/src\/a\.mjs.*existing code is not pasted/);
    expect(text).toMatch(/numbered/);
  });

  it("flags a missing modern-practices block, missing Command, and budget overflow", () => {
    const noMp = goodPacket.replace("- Modern practices:\n  - ESM export\n  - const only\n", "");
    expect((lintPacket(noMp) as { errors: string[] }).errors.join()).toMatch(/Modern practices/);
    const noCmd = goodPacket.replace("Command: `node --test test/a.test.mjs`\n", "");
    expect((lintPacket(noCmd) as { errors: string[] }).errors.join()).toMatch(/Command/);
    const huge = goodPacket.replace("export const c = 2;", "x".repeat(60_000));
    expect((lintPacket(huge, { numCtx: 16384 }) as { errors: string[] }).errors.join()).toMatch(
      /exceeds num_ctx/,
    );
  });
});

describe("record_result", () => {
  it("builds events and rejects bad input", () => {
    expect(
      buildEvent(parseArgs(["--run", "r1", "--tests", "pass"]), new Date("2026-01-01T00:00:00Z")),
    ).toEqual({
      type: "result",
      run: "r1",
      at: "2026-01-01T00:00:00.000Z",
      tests: "pass",
    });
    expect(
      buildEvent(parseArgs(["--run", "r1", "--audit", "reject", "--model", "opus"])),
    ).toMatchObject({ audit: "reject", auditor: "opus" });
    expect(() => buildEvent(parseArgs(["--tests", "pass"]))).toThrow(/--run/);
    expect(() => buildEvent(parseArgs(["--run", "r", "--tests", "maybe"]))).toThrow(/pass or fail/);
    expect(() => buildEvent(parseArgs(["--run", "r"]))).toThrow(/nothing to record/);
  });

  it("appends to .lex/runs.jsonl", async () => {
    const root = await mkdtemp(join(tmpdir(), "lex-rec-"));
    const file = (await appendEvent(root, {
      type: "result",
      run: "r1",
      at: "t",
      tests: "pass",
    })) as string;
    await appendEvent(root, { type: "result", run: "r1", at: "t", audit: "accept" });
    expect((await readFile(file, "utf8")).trim().split("\n")).toHaveLength(2);
  });
});

describe("add_test_stubs", () => {
  const verdict = `VERDICT: ACCEPT

ISSUES:
1. [severity: minor] src/a.ts:12 — trivial

MISSING TESTS:
- empty input returns []
- unicode keys are preserved

Some trailing prose.`;

  it("parses the MISSING TESTS list and ignores none", () => {
    expect(parseMissingTests(verdict)).toEqual([
      "empty input returns []",
      "unicode keys are preserved",
    ]);
    expect(parseMissingTests("VERDICT: ACCEPT\n\nMISSING TESTS:\n- none\n")).toEqual([]);
    expect(parseMissingTests("no section")).toEqual([]);
  });

  it("detects frameworks and renders stubs", () => {
    expect(detectFramework("a.test.ts", 'import { it } from "vitest";')).toBe("vitest");
    expect(detectFramework("a.test.mjs", 'import { test } from "node:test";')).toBe("node");
    expect(detectFramework("test_a.py", "")).toBe("pytest");
    expect(detectFramework("a_test.go", "")).toBe("go");
    expect(renderStub("node", 'say "hi"')).toBe(
      '// lex:missing-test\ntest.todo("say \\"hi\\"");\n',
    );
    expect(renderStub("pytest", "empty input")).toMatch(
      /@pytest.mark.skip.*\ndef test_todo_empty_input\(\):/,
    );
    expect(renderStub("go", "unicode keys")).toMatch(/func TestTodoUnicodeKeys\(t \*testing.T\)/);
  });

  it("appends only new stubs", () => {
    const first = appendStubs("test('x', () => {});\n", ["a case", "b case"], "vitest") as {
      content: string;
      added: string[];
    };
    expect(first.added).toEqual(["a case", "b case"]);
    const second = appendStubs(first.content, ["a case", "c case"], "vitest") as {
      content: string;
      added: string[];
    };
    expect(second.added).toEqual(["c case"]);
    expect(second.content.match(/lex:missing-test/g)).toHaveLength(3);
  });
});

describe("run_executor: auth and attempts", () => {
  it("builds bearer headers from a literal or an env var", () => {
    expect(authHeaders({})).toEqual({});
    expect(authHeaders({ ollama_token: "abc" })).toEqual({ Authorization: "Bearer abc" });
    expect(authHeaders({ ollama_token_env: "T" }, { T: "xyz" })).toEqual({
      Authorization: "Bearer xyz",
    });
    expect(authHeaders({ ollama_token_env: "T" }, {})).toEqual({});
  });
  it("infers the attempt number from the retry section", () => {
    expect(attemptNumber("# Task\n", undefined)).toBe(1);
    expect(
      attemptNumber(
        "## Previous attempt failed (only on retry)\nAttempt 2 failed. Fix exactly these",
        undefined,
      ),
    ).toBe(3);
    expect(attemptNumber("whatever", "4")).toBe(4);
  });
});
