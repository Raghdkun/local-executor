import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { run } from "../util/exec.js";
import { exists, readTextOr } from "../util/fs.js";
import * as log from "../util/log.js";
import type { RunContext, VerifyResult } from "./context.js";

export const VERIFY_TEST = `import { test } from "node:test";
import assert from "node:assert/strict";
import { fortyTwo } from "./answer.mjs";

test("fortyTwo returns 42", () => {
  assert.equal(fortyTwo(), 42);
});
`;

export const VERIFY_PACKET = `# Task: Return 42

## Goal (required)
Create \`answer.mjs\` exporting a function \`fortyTwo\` that returns the number 42.

## Files you may change (required)
- answer.mjs — create this file

You may NOT change any other file.

## Conventions (required)
- Language/version: JavaScript, Node.js 20, ESM
- Style: named export, no console output, no comments needed
- Allowed dependencies: none
- Modern practices:
  - ESM \`export\`, never CommonJS
  - \`const\` and arrow functions or plain \`function\`; no \`var\`

## Existing code
answer.mjs does not exist yet.

## Tests that must pass (required)
Command: \`node --test answer.test.mjs\`

### answer.test.mjs
\`\`\`js
${VERIFY_TEST}\`\`\`

## Do NOT
- Do not modify answer.test.mjs
- Do not create any file other than answer.mjs
`;

interface CheckJson {
  status: string;
  message: string;
}

async function checkLocal(root: string): Promise<Pick<VerifyResult, "check" | "checkMessage">> {
  const script = join(root, "runtime", "check_local.mjs");
  if (!(await exists(script))) return { check: "ERROR", checkMessage: `missing ${script}` };
  try {
    const r = await run(process.execPath, [script, "--json"], { timeoutMs: 15_000 });
    const parsed = JSON.parse(r.stdout.trim().split("\n").at(-1) ?? "{}") as CheckJson;
    const status = parsed.status as VerifyResult["check"];
    return { check: status ?? "ERROR", checkMessage: parsed.message ?? r.stderr };
  } catch (err) {
    return { check: "ERROR", checkMessage: (err as Error).message };
  }
}

export async function runVerifyPacket(
  root: string,
): Promise<Pick<VerifyResult, "packet" | "packetDetail" | "tokensPerSec">> {
  const work = await mkdtemp(join(tmpdir(), "lex-verify-"));
  try {
    await writeFile(join(work, "answer.test.mjs"), VERIFY_TEST);
    await writeFile(join(work, "packet.md"), VERIFY_PACKET);
    const exec = await run(
      process.execPath,
      [
        join(root, "runtime", "run_executor.mjs"),
        "--packet",
        join(work, "packet.md"),
        "--out",
        join(work, "response.md"),
        "--apply",
        "--root",
        work,
        "--json",
      ],
      { timeoutMs: 600_000 },
    );
    let tps: number | null = null;
    try {
      const j = JSON.parse(exec.stdout.trim().split("\n").at(-1) ?? "{}") as {
        tokensPerSec?: number | null;
      };
      tps = j.tokensPerSec ?? null;
    } catch {
      // no JSON line
    }
    if (!exec.ok) {
      const raw = (await readTextOr(join(work, "response.md"), "")).slice(0, 400);
      return {
        packet: "fail",
        packetDetail: `run_executor exited ${exec.exitCode ?? "?"}: ${exec.stderr.trim().split("\n")[0] ?? ""}${raw ? `\nExecutor said: ${raw}` : ""}`,
        tokensPerSec: tps,
      };
    }
    const test = await run(process.execPath, ["--test", "answer.test.mjs"], {
      cwd: work,
      timeoutMs: 60_000,
    });
    if (test.ok)
      return {
        packet: "pass",
        packetDetail: "executor wrote answer.mjs and node --test passed",
        tokensPerSec: tps,
      };
    const answer = await readTextOr(join(work, "answer.mjs"), "(answer.mjs not written)");
    return {
      packet: "fail",
      packetDetail: `tests failed. answer.mjs was:\n${answer.slice(0, 400)}`,
      tokensPerSec: tps,
    };
  } finally {
    await rm(work, { recursive: true, force: true }).catch(() => undefined);
  }
}

export async function stepVerify(ctx: RunContext): Promise<void> {
  log.header(
    "6/6",
    "Verify",
    "Run the installed check script and push one tiny real packet through the executor.",
  );
  const roots = [
    ...new Set(
      ctx.installs.filter((i) => i.record.owned.includes(i.record.root)).map((i) => i.record.root),
    ),
  ];
  if (roots.length === 0) {
    log.info("No installs to verify.");
    return;
  }
  if (ctx.opts.skipVerify) {
    log.warn("--skip-verify: not running the end-to-end check.");
    return;
  }
  let packetDone: Pick<VerifyResult, "packet" | "packetDetail" | "tokensPerSec"> | null = null;
  for (const root of roots) {
    const sp = log.spinner();
    sp.start(`Checking ${root}…`);
    const check = await checkLocal(root);
    let packet: Pick<VerifyResult, "packet" | "packetDetail" | "tokensPerSec"> = {
      packet: "skipped",
      packetDetail: check.checkMessage,
      tokensPerSec: null,
    };
    if (check.check === "READY") {
      if (packetDone) {
        packet = { ...packetDone, packetDetail: "same executor as above" };
      } else {
        sp.message(`Sending the "return 42" packet through ${root}…`);
        packet = await runVerifyPacket(root);
        packetDone = packet;
      }
    }
    const result: VerifyResult = { root, ...check, ...packet };
    ctx.verify.push(result);
    const label = `${check.check}${packet.packet !== "skipped" ? ` · packet ${packet.packet}` : ""}`;
    if (check.check === "READY" && packet.packet === "pass")
      sp.stop(`${root}: ${log.pc.green(label)}`);
    else if (check.check === "READY")
      sp.error(`${root}: ${log.pc.red(label)} — ${packet.packetDetail.split("\n")[0]}`);
    else sp.error(`${root}: ${log.pc.yellow(label)} — ${check.checkMessage}`);
  }
}
