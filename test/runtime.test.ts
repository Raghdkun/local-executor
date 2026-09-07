import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
// @ts-expect-error — untyped .mjs module
import { benchmarkPrompt, estimateFromBenchmark } from "../skill/runtime/check_local.mjs";
// The runtime is plain ESM JavaScript shipped inside skill/; import its pure helpers directly.
import {
  acquireLock,
  checkBudget,
  compareWithExisting,
  estimateSeconds,
  estimateTokens,
  expectedOutputTokens,
  formatDuration,
  lockPath,
  parseBlocks,
  releaseLock,
  safeTarget,
  stripThinking,
  // @ts-expect-error — untyped .mjs module
} from "../skill/runtime/run_executor.mjs";

describe("run_executor: parsing", () => {
  it("parses blocks with language and path", () => {
    const text =
      "```python path=src/a.py\nprint(1)\n```\n\n```ts path=src/b.ts\nexport const b = 2;\n```";
    const blocks = parseBlocks(text) as { lang: string; path: string; code: string }[];
    expect(blocks).toEqual([
      { lang: "python", path: "src/a.py", code: "print(1)\n" },
      { lang: "ts", path: "src/b.ts", code: "export const b = 2;\n" },
    ]);
  });

  it("tolerates CRLF, missing language, and c# / c++ info strings", () => {
    const text = "```c# path=A.cs\r\nclass A {}\r\n```\r\n``` path=x.txt\nhi\n```";
    const blocks = parseBlocks(text) as { path: string }[];
    expect(blocks.map((b) => b.path)).toEqual(["A.cs", "x.txt"]);
  });

  it("ignores fences without a path", () => {
    expect(parseBlocks("```js\nconsole.log(1)\n```")).toEqual([]);
  });

  it("strips <think> blocks", () => {
    expect(stripThinking("<think>hmm\nmore</think>\n```js path=a.js\n1\n```")).toBe(
      "```js path=a.js\n1\n```",
    );
  });

  it("refuses paths that escape the root", () => {
    const root = "/repo";
    expect(safeTarget(root, "src/a.ts")).toMatch(/[\\/]repo[\\/]src[\\/]a\.ts$/);
    expect(() => safeTarget(root, "../etc/passwd")).toThrow(/outside root/);
    expect(() => safeTarget(root, "/etc/passwd")).toThrow(/absolute/);
    expect(() => safeTarget(root, "C:\\Windows\\x")).toThrow(/absolute/);
    expect(() => safeTarget(root, "src/../../x")).toThrow(/outside root/);
  });
});

describe("run_executor: budget and time", () => {
  it("estimates tokens conservatively", () => {
    expect(estimateTokens("")).toBe(0);
    expect(estimateTokens("x".repeat(3600))).toBe(1000);
  });

  it("derives expected output from the Existing code section", () => {
    const packet = `# Task\n\n## Existing code\n### a.ts\n\`\`\`ts\n${"x".repeat(3600)}\n\`\`\`\n\n## Tests that must pass\n\`\`\`ts\n${"y".repeat(36000)}\n\`\`\`\n`;
    // 1000 tokens of existing code × 1.2 margin; the tests section does not count.
    const est = expectedOutputTokens(packet) as number;
    expect(est).toBeGreaterThanOrEqual(1200);
    expect(est).toBeLessThan(1250);
    expect(expectedOutputTokens("# no existing code")).toBe(1500);
  });

  it("flags packets that are close to or over num_ctx", () => {
    expect(checkBudget({ promptTokens: 4000, expectedOutput: 2000, numCtx: 16384 }).level).toBe(
      "ok",
    );
    expect(checkBudget({ promptTokens: 10000, expectedOutput: 4500, numCtx: 16384 }).level).toBe(
      "warn",
    );
    const over = checkBudget({ promptTokens: 12000, expectedOutput: 6000, numCtx: 16384 });
    expect(over.level).toBe("error");
    expect(over.message).toMatch(/truncated/);
  });

  it("estimates seconds from a benchmark and formats durations", () => {
    expect(estimateSeconds(null, 4000, 2000)).toBeNull();
    expect(estimateSeconds({ prompt_tps: 400, gen_tps: 16 }, 4000, 2000)).toBe(135);
    expect(estimateFromBenchmark({ prompt_tps: 400, gen_tps: 16 })).toBe(135);
    expect(estimateFromBenchmark(null)).toBeNull();
    expect(formatDuration(45)).toBe("45 s");
    expect(formatDuration(135)).toBe("2 min");
  });

  it("benchmark prompt is about 2k tokens and unique per nonce", () => {
    const a = benchmarkPrompt(1) as string;
    const b = benchmarkPrompt(2) as string;
    expect(a.length).toBeGreaterThan(7000);
    expect(a).not.toBe(b);
    expect(a.endsWith("Reply with the single word OK.")).toBe(true);
  });
});

describe("run_executor: lock", () => {
  it("is stable per server URL and lives in the temp dir", () => {
    expect(lockPath("http://localhost:11434")).toBe(lockPath("http://localhost:11434"));
    expect(lockPath("http://localhost:11434")).not.toBe(lockPath("http://other:11434"));
    expect(lockPath("http://x")).toContain(tmpdir());
  });

  it("acquires, refuses a second holder, and releases", async () => {
    const dir = await mkdtemp(join(tmpdir(), "lex-lock-"));
    const p = join(dir, "x.lock");
    expect(await acquireLock(p)).toEqual({ acquired: true });
    const second = (await acquireLock(p)) as { acquired: boolean; holder: { pid: number } };
    expect(second.acquired).toBe(false);
    expect(second.holder.pid).toBe(process.pid);
    await releaseLock(p);
    expect(await acquireLock(p)).toEqual({ acquired: true });
    await releaseLock(p);
  });

  it("removes a stale lock whose pid is gone", async () => {
    const dir = await mkdtemp(join(tmpdir(), "lex-lock-"));
    const p = join(dir, "x.lock");
    await writeFile(p, JSON.stringify({ pid: 2147483646, since: "2020-01-01T00:00:00Z" }));
    expect(await acquireLock(p)).toEqual({ acquired: true });
    expect(JSON.parse(await readFile(p, "utf8")).pid).toBe(process.pid);
    await releaseLock(p);
  });

  it("--wait polls until the lock is released", async () => {
    const dir = await mkdtemp(join(tmpdir(), "lex-lock-"));
    const p = join(dir, "x.lock");
    await acquireLock(p);
    setTimeout(() => void releaseLock(p), 60);
    const r = await acquireLock(p, { wait: true, pollMs: 20 });
    expect(r).toEqual({ acquired: true });
  });
});

describe("run_executor: unchanged detection", () => {
  it("classifies created, changed, unchanged, and rejected blocks", async () => {
    const root = await mkdtemp(join(tmpdir(), "lex-cmp-"));
    await writeFile(join(root, "same.ts"), "export const a = 1;\n");
    await writeFile(join(root, "diff.ts"), "export const b = 1;\n");
    const cmp = await compareWithExisting(root, [
      { path: "same.ts", code: "export const a = 1;\n" },
      { path: "diff.ts", code: "export const b = 2;\n" },
      { path: "new.ts", code: "export const c = 3;\n" },
      { path: "../escape.ts", code: "x\n" },
    ]);
    expect(cmp).toEqual({
      unchanged: ["same.ts"],
      changed: ["diff.ts"],
      created: ["new.ts"],
      rejected: [{ path: "../escape.ts", reason: expect.stringMatching(/outside root/) }],
    });
  });

  it("treats CRLF/LF differences as unchanged", async () => {
    const root = await mkdtemp(join(tmpdir(), "lex-cmp-"));
    await writeFile(join(root, "a.ts"), "a\r\nb\r\n");
    const cmp = await compareWithExisting(root, [{ path: "a.ts", code: "a\nb\n" }]);
    expect(cmp.unchanged).toEqual(["a.ts"]);
  });
});
