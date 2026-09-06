---
name: local-executor-pipeline
description: Three-role coding pipeline where the AI agent (Claude Code, Codex CLI, Cursor, Windsurf) plans and writes tests, a local open-weight model via Ollama writes the code, and a separate strong model audits the result. Use this whenever the user says "use the local model", "use the local executor", "hand this to the executor", "run the pipeline", "delegate the coding", mentions Ollama/Qwen/Gemma for a coding task, or wants to save cloud tokens by offloading implementation work to a local LLM. Also use it for first-time setup when the user asks to install or configure a local model for this workflow.
---

# Local Executor Pipeline

You are the **planner**. A small local model is the **executor**. A strong model in a separate context is the **auditor**. Each role does one thing, and the handoffs between them are strict, because a small model is only reliable when its task is narrow and its output is checked by something stronger.

```
 user request
      │
      ▼
 ┌─────────┐   task packet    ┌──────────────┐   diff + test log   ┌─────────┐
 │ PLANNER │ ───────────────▶ │  EXECUTOR    │ ──────────────────▶ │ AUDITOR │
 │ (you)   │                  │ (local LLM)  │                     │ (strong)│
 └─────────┘ ◀─────────────── └──────────────┘ ◀─────────────────  └─────────┘
      ▲          retry with            verdict: ACCEPT / REJECT + reasons
      └──────────────────── apply or loop (max 3) ──────────────────┘
```

The local model is a cost saver, not a replacement. When it can't do the job within the limits below, you do the job.

## Step 0 — Make sure the executor exists

Run `scripts/check_local.mjs` (or `check_local.sh` on macOS/Linux). It reports whether Ollama is installed, running, and has the configured model pulled. If anything is missing, run `scripts/setup_local.sh` (macOS/Linux) or tell the user to run `npx local-executor` if it's available. Read `references/models.md` for which model fits which hardware; ask before pulling anything, since downloads are several GB.

The model name lives in `scripts/config.json`. Read it rather than hard-coding a name.

## Step 1 — Inventory what you have (30 seconds, once per task)

Before planning, list in one or two lines:

- **Skills available on this machine** relevant to the task (Claude Code: `~/.claude/skills` and `./.claude/skills`; Codex: sections in `AGENTS.md`; Cursor/Windsurf: rules directories). A test-runner skill, a repo-conventions skill, a docs skill — use them to write a better packet.
- **MCP tools connected** to this agent that help: documentation lookup, issue tracker, database schema, browser. Use them during planning to get the facts the executor will need pasted into the packet.

The executor gets **no tools and no skills**. Everything it needs must be in the packet. Your inventory step is how you find that information; it is not something you hand off.

## Step 2 — Plan (you)

Turn the user's request into one or more **task packets**. A packet is the entire world the executor will see, so it has to be self-contained. Read `references/handoff-template.md` and follow it exactly.

Rules that matter for a small model:

- One packet = one file, or one function, or one tightly scoped change. If a request touches four files, that is four packets, run in dependency order.
- **Write the tests first, yourself, before the executor sees anything.** Put them in the repo. The packet tells the executor which test command must pass. This is the single biggest lever on quality: the executor can't argue with a failing test.
- Paste the relevant existing code into the packet verbatim. Do not describe it; the executor can't open files.
- State conventions explicitly, and always include the **modern-practices block** for the target language from `references/modern-practices.md`. The executor should be writing current, idiomatic, typed, explicitly-error-handled code — never deprecated APIs, never escape hatches like `any` unless the packet allows it.
- Say what NOT to do (don't refactor, don't add dependencies, don't touch other files).

## Step 3 — Execute (local model)

```
node scripts/run_executor.mjs --packet <packet.md> --out <response.md> [--apply --root <repo>]
```

(`scripts/run_executor.py` is an equivalent Python version.)

The script sends the packet to Ollama with the system prompt in `references/executor-system-prompt.md`, which forces the executor to return only fenced code blocks tagged with file paths. It writes the raw response to `--out` and, with `--apply`, also writes each block to its file path (creating a `.bak` backup alongside).

Default flow: run without `--apply`, read the output, then run the test command from the packet yourself. If tests fail, decide whether the failure is a planning error (fix the packet) or an execution error (retry, appending the failure output under `## Previous attempt failed`). Cap at **3 attempts per packet**.

## Step 4 — Audit (strong model, separate context)

Only once the tests pass. The auditor is **never the local model** and **never the same context that wrote the packet**. Use `references/audit-prompt.md`, filling in the diff, the packet, and the test output.

- **Claude Code**: spawn a subagent with `model: opus` via the Task tool.
- **Codex CLI**: run a second `codex` invocation with the audit prompt as the task.
- **Cursor / Windsurf**: open a fresh chat or composer and paste the audit prompt. Tell the user you are doing this and why.
- If none of the above is possible, do the audit yourself in a separate pass and say so; self-review is weaker.

The auditor returns `ACCEPT` or `REJECT` with a numbered, severity-tagged list of issues. On `REJECT`, feed the issues back as a new executor attempt (counts toward the 3-attempt cap). On `ACCEPT`, apply the change (if not already applied) and move to the next packet.

## Step 5 — Escalate when the pipeline can't finish

You take over the task yourself, and log one line saying why, when any of these happen:

- 3 attempts on a packet without passing tests and audit.
- The packet would exceed ~6,000 tokens of pasted code even after splitting.
- The executor returns prose instead of code twice in a row.
- The task needs tools (network, DB, browser) during implementation, not just during planning.

## Step 6 — Report

When all packets are done, tell the user in a few sentences: what was changed, how many executor attempts it took, what the auditor flagged, and anything you had to do by hand. Don't paste the full diff unless asked.

## When to skip the pipeline

If the task is a one-line fix, a rename, or something you can do faster than writing a packet, just do it and mention that the pipeline wasn't worth invoking. The pipeline earns its overhead on medium tasks: implementing a spec'd function, filling in a module against tests, mechanical but non-trivial code.

## Files in this skill

- `scripts/config.json` — model name, Ollama URL, context size, timeouts
- `scripts/check_local.mjs` / `check_local.sh` — is everything installed and running?
- `scripts/setup_local.sh` — install Ollama + pull model (macOS/Linux)
- `scripts/run_executor.mjs` / `run_executor.py` — send a packet, get code back, optionally apply
- `references/models.md` — which local model fits which hardware
- `references/handoff-template.md` — exact packet format for the executor
- `references/executor-system-prompt.md` — the system prompt the executor runs under
- `references/modern-practices.md` — per-language conventions block to paste into packets
- `references/audit-prompt.md` — exact prompt for the auditor and its verdict format
