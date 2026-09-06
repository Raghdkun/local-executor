# Local Executor Pipeline

You are the **planner**. A small local model running in Ollama is the **executor**. A strong model in a separate context is the **auditor**. Each role does one thing, and the handoffs between them are strict, because a small model is only reliable when its task is narrow and its output is checked by something stronger.

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

This file is agent-neutral. The adapter that loaded it (Claude Code skill, Codex AGENTS block, Cursor/Windsurf rule) tells you how to spawn the auditor in your environment. Files for this install live at:

- Core docs: `{{LEX_CORE}}`
- Runtime scripts and config: `{{LEX_RUNTIME}}`
- Configured executor model: `{{LEX_MODEL}}` (read `{{LEX_CONFIG}}`; never hard-code a tag)

## Step 0 — Make sure the executor exists

Run:

```
node "{{LEX_RUNTIME}}/check_local.mjs"
```

It prints `READY`, `NOT RUNNING`, or `MISSING MODEL`, with the fix. If anything is missing, tell the user to run `npx local-executor` (or `lex doctor`). Do not pull models yourself without asking; downloads are several GB.

## Step 1 — Inventory what you have (30 seconds, once per task)

Before planning, list in one or two lines:

- **Skills available on this machine** relevant to the task. Claude Code: `~/.claude/skills` and `./.claude/skills`. Codex: sections in `AGENTS.md` and `~/.codex/skills`. Cursor: `.cursor/rules`. Windsurf: `.windsurf/rules`. A test-runner skill, a repo-conventions skill, a docs skill — use them to write a better packet.
- **MCP tools connected** to this agent that help: documentation lookup, issue tracker, database schema, browser. Use them during planning to get the facts the executor will need pasted into the packet.

State which ones you will use for this task, e.g. "Using: context7 MCP for the Prisma API; repo's `testing` skill for the test command." If none apply, say "No extra skills/tools needed."

The executor gets **no tools and no skills**. Everything it needs must be in the packet. Your inventory step is how you find that information; it is not something you hand off.

## Step 2 — Plan (you)

Turn the user's request into one or more **task packets**. A packet is the entire world the executor will see, so it has to be self-contained. Read `{{LEX_CORE}}/handoff-template.md` and follow it exactly.

Rules that matter for a small model:

- One packet = one file, or one function, or one tightly scoped change. If a request touches four files, that is four packets, run in dependency order.
- **Write the tests first, yourself, before the executor sees anything.** Put them in the repo. The packet tells the executor which test command must pass. This is the single biggest lever on quality: the executor can't argue with a failing test.
- Paste the relevant existing code into the packet verbatim. Do not describe it; the executor can't open files.
- State conventions explicitly, and **always include the modern-practices block** for the target language from `{{LEX_CORE}}/modern-practices.md`: current stable language version, idiomatic patterns, no deprecated APIs, typed where the language supports it, explicit error handling, no `any` / `interface{}`-style escape hatches unless the packet justifies them.
- Say what NOT to do (don't refactor, don't add dependencies, don't touch other files).

## Step 3 — Execute (local model)

Write the packet to a file (for example `.lex/packet-1.md` inside the repo, or a temp dir), then run:

```
node "{{LEX_RUNTIME}}/run_executor.mjs" --packet <packet.md> --out <response.md> [--apply --root <repo>]
```

The script sends the packet to Ollama with the system prompt in `{{LEX_CORE}}/executor-system-prompt.md`, which forces the executor to return only fenced code blocks tagged with file paths. It writes the raw response to `--out` and, with `--apply`, also writes each block to its file path under `--root` (creating a `.bak` backup alongside). Exit codes: `0` ok, `2` Ollama error, `3` no code blocks, `4` the executor declared it cannot do the task.

Default flow: run without `--apply`, read the output, then apply and run the test command from the packet yourself. If tests fail, decide whether the failure is a planning error (fix the packet) or an execution error (retry, appending the failure output under `## Previous attempt failed`). Cap at **3 attempts per packet**.

## Step 4 — Audit (strong model, separate context)

Only once the tests pass. The auditor is **never the local model** and **never the same context that wrote the packet**. Use `{{LEX_CORE}}/audit-prompt.md`, filling in the packet, the diff, and the test output.

- **Claude Code**: spawn a subagent with `model: opus` via the Task tool, with the audit prompt as its task.
- **Codex CLI**: run a second `codex exec` invocation with the audit prompt as the task (a fresh context, ideally a stronger model via `--model`).
- **Cursor / Windsurf**: they cannot spawn subagents. Open a fresh chat/composer, paste the audit prompt, and bring the verdict back. Tell the user you are doing this and why.
- If none of the above is possible, do the audit yourself in a separate pass and say so; self-review is weaker.

The auditor returns `ACCEPT` or `REJECT` with a numbered, severity-tagged list of issues. On `REJECT`, feed the issues back as a new executor attempt (counts toward the 3-attempt cap). On `ACCEPT`, apply the change (if not already applied) and move to the next packet.

## Step 5 — Escalate when the pipeline can't finish

You take over the task yourself, and log one line saying why, when any of these happen:

- 3 attempts on a packet without passing tests and audit.
- The packet would exceed ~6,000 tokens of pasted code even after splitting.
- The executor returns prose instead of code twice in a row, or exits with code `4` (declared it cannot).
- The task needs tools (network, DB, browser) during implementation, not just during planning.

Example log line: `Escalating: 3 attempts on packet-2 (auth middleware); executor kept dropping the async error path. Doing it myself.`

## Step 6 — Report

When all packets are done, tell the user in a few sentences: what was changed, how many executor attempts it took, what the auditor flagged, and anything you had to do by hand. Don't paste the full diff unless asked.

## When to skip the pipeline

If the task is a one-line fix, a rename, or something you can do faster than writing a packet, just do it and mention that the pipeline wasn't worth invoking. The pipeline earns its overhead on medium tasks: implementing a spec'd function, filling in a module against tests, mechanical but non-trivial code.

## Files in this install

- `{{LEX_CONFIG}}` — model name, Ollama URL, context size, timeouts
- `{{LEX_RUNTIME}}/check_local.mjs` — is everything installed and running?
- `{{LEX_RUNTIME}}/run_executor.mjs` — send a packet, get code back, optionally apply
- `{{LEX_CORE}}/handoff-template.md` — exact packet format for the executor
- `{{LEX_CORE}}/executor-system-prompt.md` — the system prompt the executor runs under
- `{{LEX_CORE}}/modern-practices.md` — per-language conventions block to paste into packets
- `{{LEX_CORE}}/audit-prompt.md` — exact prompt for the auditor and its verdict format
- `{{LEX_CORE}}/models.md` — which local model fits which hardware (generated for this machine)
