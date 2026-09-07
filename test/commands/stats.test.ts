import { describe, expect, it } from "vitest";
import {
  aggregate,
  formatAggregate,
  parseRuns,
  sizeBucket,
  summarizeRuns,
} from "../../src/commands/stats.js";

const lines = [
  {
    type: "run",
    at: "t1",
    run: "a",
    packet: "p1",
    attempt: 1,
    model: "qwen3.5:9b",
    promptTokens: 2100,
    elapsedSeconds: 75,
    tokensPerSec: 15.7,
    outcome: "ok",
  },
  { type: "result", at: "t2", run: "a", tests: "fail" },
  {
    type: "run",
    at: "t3",
    run: "b",
    packet: "p1",
    attempt: 2,
    model: "qwen3.5:9b",
    promptTokens: 2500,
    elapsedSeconds: 79,
    tokensPerSec: 15.6,
    outcome: "ok",
  },
  { type: "result", at: "t4", run: "b", tests: "pass" },
  { type: "result", at: "t5", run: "b", audit: "accept", auditor: "opus" },
  {
    type: "run",
    at: "t6",
    run: "c",
    packet: "p2",
    attempt: 1,
    model: "qwen3.5:4b",
    promptTokens: 900,
    elapsedSeconds: 20,
    tokensPerSec: 40,
    outcome: "ok",
  },
  { type: "result", at: "t7", run: "c", tests: "pass" },
  {
    type: "run",
    at: "t8",
    run: "d",
    packet: "p3",
    attempt: 1,
    model: "qwen3.5:4b",
    promptTokens: 5000,
    elapsedSeconds: 60,
    tokensPerSec: 38,
    outcome: "unchanged",
  },
  "not json",
  { type: "result", at: "t9", run: "zzz", tests: "pass" },
];

describe("stats", () => {
  it("folds events into runs and skips corrupt lines and unknown run ids", () => {
    const runs = summarizeRuns(
      parseRuns(lines.map((l) => (typeof l === "string" ? l : JSON.stringify(l))).join("\n")),
    );
    expect(runs).toHaveLength(4);
    const b = runs.find((r) => r.run === "b");
    expect(b).toMatchObject({ attempt: 2, tests: "pass", audit: "accept" });
  });

  it("aggregates first-attempt pass rate per model", () => {
    const runs = summarizeRuns(
      parseRuns(
        lines
          .filter((l) => typeof l !== "string")
          .map((l) => JSON.stringify(l))
          .join("\n"),
      ),
    );
    const byModel = aggregate(runs, (r) => r.model);
    const q9 = byModel.find((a) => a.key === "qwen3.5:9b");
    const q4 = byModel.find((a) => a.key === "qwen3.5:4b");
    expect(q9).toMatchObject({
      runs: 2,
      firstAttempts: 1,
      firstAttemptPass: 0,
      testsPass: 1,
      testsRecorded: 2,
      auditAccept: 1,
      auditRecorded: 1,
    });
    expect(q4).toMatchObject({
      runs: 2,
      firstAttempts: 2,
      firstAttemptPass: 1,
      unchangedOrCannot: 1,
    });
    expect(q9?.medianSeconds).toBe(77);
    expect(formatAggregate(q4 as NonNullable<typeof q4>)).toMatch(
      /first-attempt pass 50% \(1\/2\)/,
    );
  });

  it("buckets packet sizes", () => {
    expect(sizeBucket(900)).toBe("< 2k");
    expect(sizeBucket(2100)).toBe("2–4k");
    expect(sizeBucket(5000)).toBe("4–8k");
    expect(sizeBucket(9000)).toBe("8k+");
  });
});
