import { describe, expect, it } from "vitest";
import { startHints, summaryLines } from "../../src/commands/init.js";
import { OllamaClient } from "../../src/ollama/client.js";
import type { RunContext } from "../../src/steps/context.js";

describe("init summary", () => {
  it("has a start hint for every agent", () => {
    expect(Object.keys(startHints).sort()).toEqual(["claude", "codex", "cursor", "windsurf"]);
  });

  it("summarizes the run", () => {
    const ctx = {
      client: new OllamaClient("http://localhost:11434"),
      ollama: { version: "0.33.3", skipped: false, binary: null, latest: null },
      model: "qwen3.5:9b",
      pulled: true,
      warmup: { tokensPerSec: 42.5 },
      installs: [
        {
          record: {
            agent: "claude",
            scope: "user",
            root: "/h/.claude/skills/local-executor-pipeline",
            owned: ["/h/.claude/skills/local-executor-pipeline"],
            marked: [],
          },
          actions: [],
        },
        {
          record: {
            agent: "codex",
            scope: "user",
            root: "/h/.codex/local-executor",
            owned: ["/h/.codex/local-executor"],
            marked: ["/h/.codex/AGENTS.md"],
          },
          actions: [],
        },
      ],
      verify: [{ packet: "pass" }],
    } as unknown as RunContext;
    const lines = summaryLines(ctx);
    expect(lines[0]).toContain("v0.33.3");
    expect(lines[1]).toContain("qwen3.5:9b — 42.5 tok/s");
    expect(lines.find((l) => l.startsWith("Codex CLI"))).toContain("AGENTS.md");
    expect(lines.at(-1)).toBe("Verify    1/1 install(s) passed the end-to-end packet");
    ctx.verify = [
      { packet: "pass" },
      { packet: "skipped", check: "MISSING MODEL" },
    ] as unknown as RunContext["verify"];
    expect(summaryLines(ctx).at(-1)).toBe(
      "Verify    1/1 install(s) passed the end-to-end packet (1 skipped: missing model)",
    );
    ctx.verify = [{ packet: "skipped", check: "NOT RUNNING" }] as unknown as RunContext["verify"];
    expect(summaryLines(ctx).at(-1)).toBe("Verify    not run (1 skipped: not running)");
  });
});
