---
name: local-executor-pipeline
description: Three-role coding pipeline where Claude plans and writes tests, a local open-weight model via Ollama writes the code, and an Opus subagent audits the result. Use this whenever the user says "use the local model", "use the local executor", "hand this to the executor", "run the pipeline", "delegate the coding", mentions Ollama/Qwen/Gemma for a coding task, or wants to save cloud tokens by offloading implementation work to a local LLM.
---

# Local Executor Pipeline (Claude Code adapter)

Read `{{LEX_CORE}}/PIPELINE.md` now and follow it. This file only covers what is specific to Claude Code.

Installed by `local-executor` v{{LEX_VERSION}}. Executor model: `{{LEX_MODEL}}` (from `{{LEX_CONFIG}}`).

## Running the scripts

Use the Bash tool. The check is quick; the executor **takes minutes** (see Step 0/3 in PIPELINE.md), so run it with `run_in_background: true` and wait for the completion notification, or give it a `timeout` of 600000. A default 2-minute Bash timeout will kill it mid-generation.

```bash
node "{{LEX_RUNTIME}}/check_local.mjs"            # add --bench once per model to measure speed
node "{{LEX_RUNTIME}}/run_executor.mjs" --packet .lex/packet-1.md --dry-run
node "{{LEX_RUNTIME}}/run_executor.mjs" --packet .lex/packet-1.md --out .lex/response-1.md   # background
```

One packet at a time: the runner exits 5 if another one is running (or queues with `--wait`). Write packets under `.lex/` in the repo; the runner creates `.lex/.gitignore` so nothing in there is committed.

## Inventory step (Step 1 in PIPELINE.md)

- Skills: list `~/.claude/skills/` and `./.claude/skills/`; the ones already loaded in your context count too.
- MCP tools: whatever `mcp__*` tools you see in your tool list. Prefer a docs MCP (e.g. context7) over guessing an API when writing the packet.

## Model choice (Step 0b in PIPELINE.md)

- Planner: you. If you are running as Haiku or a "fast" tier and the task is not mechanical, tell the user and suggest `/model` to the newest Opus/Fable-class model before planning.
- Auditor: Task tool with `model: "opus"` — the alias resolves to the newest Opus, so this stays current as models ship. Use `subagent_type: "general-purpose"`.
- Executor: `--model <tag>` on `run_executor.mjs`, chosen per packet from the `available` list in `check_local.mjs --json` using the table in PIPELINE.md.

## Audit step (Step 4 in PIPELINE.md)

Spawn the auditor with the Task tool. It must be a **separate subagent** so its context contains only the audit prompt, the packet, the diff, and the test output:

```
Task(
  subagent_type: "general-purpose",
  model: "opus",
  description: "Audit local-executor diff",
  prompt: <contents of {{LEX_CORE}}/audit-prompt.md with PACKET, DIFF, TEST_OUTPUT filled in>
)
```

Never audit in your own context when the Task tool is available. The auditor may read the repo but must not edit it; say so in the prompt.

## After tests and audit

- `node "{{LEX_RUNTIME}}/record_result.mjs" --run <id> --tests pass|fail`, then `--audit accept|reject --model opus`. The user can see pass rates with `lex stats`.
- On ACCEPT with MISSING TESTS: save the subagent's reply to `.lex/audit-N.md` and run `node "{{LEX_RUNTIME}}/add_test_stubs.mjs" --verdict .lex/audit-N.md --into <test file>`, then fill the stubs (Edit tool) or make them the next packet.

## Escalation

When PIPELINE.md says to escalate, do the task yourself in this same session and tell the user in one line why the executor could not finish.
