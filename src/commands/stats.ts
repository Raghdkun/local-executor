import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import * as log from "../util/log.js";

/** One line of .lex/runs.jsonl: an executor run or a later result event. */
export interface RunEvent {
  type: "run" | "result";
  at: string;
  run: string;
  packet?: string;
  attempt?: number;
  model?: string;
  promptTokens?: number;
  evalCount?: number;
  elapsedSeconds?: number;
  tokensPerSec?: number | null;
  outcome?: "ok" | "no_blocks" | "cannot" | "unchanged";
  tests?: "pass" | "fail";
  audit?: "accept" | "reject";
  auditor?: string;
  escalated?: string;
}

export interface RunSummary {
  run: string;
  packet: string;
  attempt: number;
  model: string;
  promptTokens: number;
  elapsedSeconds: number;
  tokensPerSec: number | null;
  outcome: string;
  tests: "pass" | "fail" | null;
  audit: "accept" | "reject" | null;
  escalated: string | null;
}

export function parseRuns(text: string): RunEvent[] {
  const out: RunEvent[] = [];
  for (const line of text.split("\n")) {
    const t = line.trim();
    if (!t) continue;
    try {
      out.push(JSON.parse(t) as RunEvent);
    } catch {
      // skip corrupt line
    }
  }
  return out;
}

/** Fold run + result events into one record per run id. */
export function summarizeRuns(events: RunEvent[]): RunSummary[] {
  const byRun = new Map<string, RunSummary>();
  for (const e of events) {
    if (e.type === "run") {
      byRun.set(e.run, {
        run: e.run,
        packet: e.packet ?? "?",
        attempt: e.attempt ?? 1,
        model: e.model ?? "?",
        promptTokens: e.promptTokens ?? 0,
        elapsedSeconds: e.elapsedSeconds ?? 0,
        tokensPerSec: e.tokensPerSec ?? null,
        outcome: e.outcome ?? "?",
        tests: null,
        audit: null,
        escalated: null,
      });
    }
  }
  for (const e of events) {
    if (e.type !== "result") continue;
    const r = byRun.get(e.run);
    if (!r) continue;
    if (e.tests) r.tests = e.tests;
    if (e.audit) r.audit = e.audit;
    if (e.escalated) r.escalated = e.escalated;
  }
  return [...byRun.values()];
}

export function sizeBucket(promptTokens: number): string {
  if (promptTokens < 2000) return "< 2k";
  if (promptTokens < 4000) return "2–4k";
  if (promptTokens < 8000) return "4–8k";
  return "8k+";
}

export interface Aggregate {
  key: string;
  runs: number;
  firstAttempts: number;
  firstAttemptPass: number;
  testsPass: number;
  testsRecorded: number;
  auditAccept: number;
  auditRecorded: number;
  medianSeconds: number;
  avgTokensPerSec: number | null;
  unchangedOrCannot: number;
}

function median(nums: number[]): number {
  if (nums.length === 0) return 0;
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? (s[mid] ?? 0) : ((s[mid - 1] ?? 0) + (s[mid] ?? 0)) / 2;
}

export function aggregate(runs: RunSummary[], keyOf: (r: RunSummary) => string): Aggregate[] {
  const groups = new Map<string, RunSummary[]>();
  for (const r of runs) {
    const k = keyOf(r);
    groups.set(k, [...(groups.get(k) ?? []), r]);
  }
  return [...groups.entries()]
    .map(([key, rs]) => {
      const first = rs.filter((r) => r.attempt === 1);
      const tps = rs.map((r) => r.tokensPerSec).filter((t): t is number => t !== null);
      return {
        key,
        runs: rs.length,
        firstAttempts: first.length,
        firstAttemptPass: first.filter((r) => r.tests === "pass").length,
        testsPass: rs.filter((r) => r.tests === "pass").length,
        testsRecorded: rs.filter((r) => r.tests !== null).length,
        auditAccept: rs.filter((r) => r.audit === "accept").length,
        auditRecorded: rs.filter((r) => r.audit !== null).length,
        medianSeconds: median(rs.map((r) => r.elapsedSeconds)),
        avgTokensPerSec: tps.length
          ? Math.round((tps.reduce((a, b) => a + b, 0) / tps.length) * 10) / 10
          : null,
        unchangedOrCannot: rs.filter(
          (r) => r.outcome === "unchanged" || r.outcome === "cannot" || r.outcome === "no_blocks",
        ).length,
      };
    })
    .sort((a, b) => b.runs - a.runs);
}

function pct(n: number, d: number): string {
  return d === 0 ? "n/a" : `${Math.round((n / d) * 100)}%`;
}

export function formatAggregate(a: Aggregate): string {
  return `${a.runs} run(s) · first-attempt pass ${pct(a.firstAttemptPass, a.firstAttempts)} (${a.firstAttemptPass}/${a.firstAttempts}) · tests pass ${pct(a.testsPass, a.testsRecorded)} · audit accept ${pct(a.auditAccept, a.auditRecorded)} · median ${Math.round(a.medianSeconds)} s · ${a.avgTokensPerSec ?? "?"} tok/s · ${a.unchangedOrCannot} non-result(s)`;
}

export async function runStats(opts: { json: boolean; root: string }): Promise<number> {
  log.configureUi({ json: opts.json });
  const file = join(resolve(opts.root), ".lex", "runs.jsonl");
  const text = await readFile(file, "utf8").catch(() => "");
  const runs = summarizeRuns(parseRuns(text));
  const byModel = aggregate(runs, (r) => r.model);
  const bySize = aggregate(runs, (r) => sizeBucket(r.promptTokens));
  const byAttempt = aggregate(runs, (r) => `attempt ${r.attempt}`);
  if (opts.json) {
    process.stdout.write(
      `${JSON.stringify({ file, runs: runs.length, byModel, bySize, byAttempt, recent: runs.slice(-20) }, null, 2)}\n`,
    );
    return 0;
  }
  log.intro("lex stats");
  if (runs.length === 0) {
    log.info(
      `No runs recorded in ${file}. The executor writes one line per run; record test/audit results with runtime/record_result.mjs.`,
    );
    log.outro("Nothing to show yet.");
    return 0;
  }
  log.info(`${runs.length} run(s) in ${file}`);
  log.table(byModel.map((a) => [a.key, formatAggregate(a)]));
  log.message(log.pc.bold("By packet size (prompt tokens)"));
  log.table(bySize.map((a) => [a.key, formatAggregate(a)]));
  log.message(log.pc.bold("By attempt"));
  log.table(byAttempt.map((a) => [a.key, formatAggregate(a)]));
  const unrecorded = runs.filter((r) => r.outcome === "ok" && r.tests === null).length;
  if (unrecorded > 0)
    log.warn(
      `${unrecorded} successful run(s) have no test result recorded; the pipeline asks the planner to run record_result.mjs after the tests.`,
    );
  const escalated = runs.filter((r) => r.escalated).length;
  if (escalated > 0) log.info(`${escalated} run(s) ended in escalation.`);
  log.outro("Use these numbers to tune fallback_model vs model, and to decide when to upgrade.");
  return 0;
}
