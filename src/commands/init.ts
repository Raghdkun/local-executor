import { agentNames } from "../agents/types.js";
import { OllamaClient } from "../ollama/client.js";
import { stepAgents } from "../steps/agents.js";
import type { InitOptions, RunContext } from "../steps/context.js";
import { stepHardware } from "../steps/hardware.js";
import { stepModel } from "../steps/model.js";
import { stepOllama } from "../steps/ollama.js";
import { stepSkills } from "../steps/skills.js";
import { stepVerify } from "../steps/verify.js";
import { contractTilde } from "../util/fs.js";
import * as log from "../util/log.js";
import { packageVersion } from "../util/pkg.js";

export const startHints: Record<string, string> = {
  claude: 'In Claude Code, say: "use the local executor to implement X"',
  codex: 'In Codex CLI, say: "use the local executor pipeline to implement X"',
  cursor:
    'In Cursor chat, say: "use the local executor pipeline to implement X" (rule: .cursor/rules/local-executor.mdc)',
  windsurf:
    'In Windsurf Cascade, say: "use the local executor pipeline to implement X" (rule: .windsurf/rules/local-executor.md)',
};

export function summaryLines(ctx: RunContext): string[] {
  const lines: string[] = [];
  lines.push(
    `Ollama    ${ctx.ollama.version ? `v${ctx.ollama.version}` : "not reachable"}${ctx.ollama.skipped ? " (setup skipped)" : ""} at ${ctx.client.baseUrl}`,
  );
  const speed = ctx.warmup?.tokensPerSec
    ? `${ctx.warmup.tokensPerSec} tok/s`
    : ctx.pulled
      ? "speed not measured"
      : "not pulled";
  lines.push(`Model     ${ctx.model ?? "none"} — ${speed}`);
  if (ctx.installs.length === 0) lines.push("Agents    none configured");
  for (const i of ctx.installs) {
    const adapter =
      i.record.marked[0] ?? i.record.owned.find((p) => p !== i.record.root) ?? i.record.root;
    lines.push(
      `${agentNames[i.record.agent].padEnd(9)} ${i.record.scope} → ${contractTilde(adapter)}`,
    );
  }
  const v = ctx.verify;
  if (v.length > 0) {
    const pass = v.filter((r) => r.packet === "pass").length;
    const skipped = v.filter((r) => r.packet === "skipped").length;
    const ran = v.length - skipped;
    const why =
      skipped > 0
        ? ` (${skipped} skipped: ${v.find((r) => r.packet === "skipped")?.check.toLowerCase()})`
        : "";
    lines.push(
      `Verify    ${ran === 0 ? "not run" : `${pass}/${ran} install(s) passed the end-to-end packet`}${why}`,
    );
  }
  return lines;
}

export function resolveToken(
  opts: Pick<InitOptions, "ollamaToken" | "ollamaTokenEnv">,
): string | undefined {
  if (opts.ollamaToken) return opts.ollamaToken;
  if (opts.ollamaTokenEnv) return process.env[opts.ollamaTokenEnv];
  return undefined;
}

export async function runInit(opts: InitOptions): Promise<number> {
  log.configureUi({ yes: opts.yes, json: opts.json });
  if (!log.ui.tty && !opts.yes && !opts.json) {
    process.stderr.write("lex: stdout is not a terminal; running as if --yes was given.\n");
  }
  const ctx: RunContext = {
    opts,
    client: new OllamaClient(opts.ollamaUrl, undefined, resolveToken(opts)),
    cwd: process.cwd(),
    ollama: { binary: null, version: null, latest: null, skipped: false },
    detections: [],
    agents: [],
    projectRoot: null,
    installProject: false,
    installs: [],
    verify: [],
    warnings: [],
  };

  log.intro(`local-executor v${packageVersion()}`);
  log.message(
    "Planner (your cloud agent) → Executor (local model via Ollama) → Auditor (strong model, fresh context).",
  );

  await stepOllama(ctx);
  await stepHardware(ctx);
  await stepModel(ctx);
  await stepAgents(ctx);
  await stepSkills(ctx);
  await stepVerify(ctx);

  const failedVerify = ctx.verify.some((r) => r.packet === "fail");
  if (opts.json) {
    process.stdout.write(
      `${JSON.stringify(
        {
          ok: !failedVerify,
          ollama: ctx.ollama,
          hardware: ctx.hw,
          effectiveMemoryGB: ctx.report?.effectiveMemory.gb,
          tier: ctx.report?.tier.label,
          model: ctx.model,
          pulled: ctx.pulled ?? false,
          tokensPerSec: ctx.warmup?.tokensPerSec ?? null,
          agents: ctx.agents,
          installs: ctx.installs.map((i) => i.record),
          verify: ctx.verify,
          warnings: ctx.warnings,
        },
        null,
        2,
      )}\n`,
    );
  } else {
    log.box(summaryLines(ctx).join("\n"), "Summary");
    for (const w of ctx.warnings) log.warn(w);
    const hints = ctx.agents.map((a) => `• ${startHints[a]}`);
    if (hints.length > 0) log.note(hints.join("\n"), "How to start");
    log.outro(
      failedVerify ? log.pc.red("Setup finished with a failing verification. See above.") : "Done.",
    );
  }
  return failedVerify ? 3 : 0;
}
