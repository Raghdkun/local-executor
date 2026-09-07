import { Command, Option } from "commander";
import { parseAgentList } from "./agents/types.js";
import { runDoctor } from "./commands/doctor.js";
import { runInit } from "./commands/init.js";
import { runModels } from "./commands/models.js";
import { runPacketCheck } from "./commands/packet.js";
import { runStats } from "./commands/stats.js";
import { runSwitch } from "./commands/switch.js";
import { runUninstall } from "./commands/uninstall.js";
import { DEFAULT_OLLAMA_URL } from "./ollama/client.js";
import { packageVersion } from "./util/pkg.js";
import { normalizeUrl } from "./util/url.js";

const program = new Command();

program
  .name("lex")
  .description(
    "Set up a planner → local executor → auditor coding pipeline.\nInstalls Ollama, picks a model for your hardware, and teaches your AI agents to use it.",
  )
  .version(packageVersion(), "-v, --version")
  .showHelpAfterError()
  .addHelpText(
    "after",
    `
Examples:
  $ npx local-executor                 interactive setup (same as: lex init)
  $ lex --yes                          zero prompts, sane defaults
  $ lex init --model qwen3.5:4b --agents claude,codex --yes
  $ lex init --skip-ollama --agents cursor --project
  $ lex models                         ranked catalog for this machine
  $ lex doctor                         diagnostics, non-zero exit on failure
  $ lex switch gemma4:e4b              pull + update every installed config
  $ lex packet check .lex/packet-1.md  lint a packet before sending it
  $ lex stats                          pass rates per model from .lex/runs.jsonl
  $ lex init --ollama-url http://gpu-box:11434 --ollama-token-env LEX_OLLAMA_TOKEN --agents claude
                                       use a shared GPU box as the executor
  $ lex uninstall --agents codex       remove what lex installed for Codex
`,
  );

const ollamaUrlOption = new Option("--ollama-url <url>", "Ollama server URL")
  .default(DEFAULT_OLLAMA_URL)
  .env("OLLAMA_HOST");

function initCommand(cmd: Command): Command {
  return cmd
    .option("-y, --yes", "accept defaults; never prompt", false)
    .option("--json", "machine-readable output; implies --yes", false)
    .option("-m, --model <tag>", "executor model tag (skips the selection prompt)")
    .option("-a, --agents <list>", "comma-separated: claude,codex,cursor,windsurf", (v: string) =>
      parseAgentList(v),
    )
    .option("--skip-ollama", "do not detect/install/start Ollama", false)
    .option("--skip-pull", "do not pull the model", false)
    .option("--skip-verify", "do not run the end-to-end check", false)
    .option("--project", "also install project-level files (requires a git repo)")
    .option("--no-project", "never install project-level files")
    .option(
      "--allow-install",
      "in --yes mode, permit running the Ollama install/upgrade command",
      false,
    )
    .option(
      "--ollama-token-env <name>",
      "env var holding a bearer token for a remote executor (recommended)",
    )
    .option(
      "--ollama-token <token>",
      "bearer token for a remote executor (written to config.json; prefer --ollama-token-env)",
    )
    .addOption(ollamaUrlOption)
    .action(async (opts) => {
      const code = await runInit({
        yes: Boolean(opts.yes) || Boolean(opts.json),
        json: Boolean(opts.json),
        ollamaUrl: normalizeUrl(opts.ollamaUrl),
        ...(opts.ollamaToken ? { ollamaToken: String(opts.ollamaToken) } : {}),
        ...(opts.ollamaTokenEnv ? { ollamaTokenEnv: String(opts.ollamaTokenEnv) } : {}),
        model: opts.model,
        agents: opts.agents,
        skipOllama: Boolean(opts.skipOllama),
        skipPull: Boolean(opts.skipPull),
        skipVerify: Boolean(opts.skipVerify),
        project: typeof opts.project === "boolean" ? opts.project : undefined,
        allowInstall: Boolean(opts.allowInstall),
      });
      process.exitCode = code;
    });
}

initCommand(
  program.command("init", { isDefault: true }).description("interactive setup (default command)"),
);

program
  .command("doctor")
  .description("re-run all checks and print a diagnostic table; exits 1 on any failure")
  .option("--json", "machine-readable output", false)
  .addOption(ollamaUrlOption)
  .action(async (opts) => {
    process.exitCode = await runDoctor({
      json: Boolean(opts.json),
      ollamaUrl: normalizeUrl(opts.ollamaUrl),
    });
  });

program
  .command("models")
  .description("show the model catalog ranked for this machine (installs nothing)")
  .option("--json", "machine-readable output", false)
  .option("--all", "include models that do not fit in memory", false)
  .option(
    "--refresh",
    "check ollama.com for newer tags/families and catalog drift (network)",
    false,
  )
  .action(async (opts) => {
    process.exitCode = await runModels({
      json: Boolean(opts.json),
      all: Boolean(opts.all),
      refresh: Boolean(opts.refresh),
    });
  });

program
  .command("switch <tag>")
  .description("pull <tag> if needed and point every installed config.json at it")
  .option("-y, --yes", "never prompt", false)
  .option("--json", "machine-readable output; implies --yes", false)
  .addOption(ollamaUrlOption)
  .action(async (tag: string, opts) => {
    process.exitCode = await runSwitch(tag, {
      yes: Boolean(opts.yes) || Boolean(opts.json),
      json: Boolean(opts.json),
      ollamaUrl: normalizeUrl(opts.ollamaUrl),
    });
  });

program
  .command("stats")
  .description(
    "first-attempt pass rate, audit accept rate, and speed per model and packet size from .lex/runs.jsonl",
  )
  .option("--json", "machine-readable output", false)
  .option("--root <dir>", "repository root holding .lex/", ".")
  .action(async (opts) => {
    process.exitCode = await runStats({ json: Boolean(opts.json), root: String(opts.root) });
  });

const packet = program.command("packet").description("work with task packets");
packet
  .command("check <file>")
  .description(
    "lint a packet against the handoff template and the context budget; exit 1 on errors",
  )
  .option("--json", "machine-readable output", false)
  .option(
    "--num-ctx <n>",
    "context window to check against (default: installed config)",
    (v: string) => Number(v),
  )
  .action(async (file: string, opts) => {
    process.exitCode = await runPacketCheck(file, {
      json: Boolean(opts.json),
      ...(opts.numCtx ? { numCtx: Number(opts.numCtx) } : {}),
    });
  });

program
  .command("uninstall")
  .description("remove what lex installed (respects marker blocks in shared files)")
  .option("-y, --yes", "never prompt", false)
  .option("--json", "machine-readable output; implies --yes", false)
  .option("-a, --agents <list>", "only these agents", (v: string) => parseAgentList(v))
  .action(async (opts) => {
    process.exitCode = await runUninstall({
      yes: Boolean(opts.yes) || Boolean(opts.json),
      json: Boolean(opts.json),
      agents: opts.agents,
    });
  });

program.parseAsync(process.argv).catch((err: unknown) => {
  process.stderr.write(`lex: ${(err as Error).message}\n`);
  process.exitCode = 1;
});
