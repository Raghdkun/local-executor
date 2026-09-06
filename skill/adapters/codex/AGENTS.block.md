## Local executor pipeline (installed by local-executor v{{LEX_VERSION}})

When the user says "use the local model", "use the local executor", "hand this to the executor", "run the pipeline", or wants to save cloud tokens on implementation work, follow `{{LEX_CORE}}/PIPELINE.md`. You are the **planner**: you write the plan and the tests; the local model (`{{LEX_MODEL}}`, configured in `{{LEX_CONFIG}}`) writes the code; a separate reviewer pass audits it.

Codex-specific notes:

- Check the executor: `node "{{LEX_RUNTIME}}/check_local.mjs"`.
- Run a packet: `node "{{LEX_RUNTIME}}/run_executor.mjs" --packet .lex/packet-1.md --out .lex/response-1.md`. The script only talks to `127.0.0.1:11434`. If the sandbox blocks that call, ask for approval to run it outside the sandbox rather than disabling the sandbox globally.
- Inventory (Step 1): skills live in `~/.codex/skills/` and in sections of this file; MCP servers are in `~/.codex/config.toml`.
- Audit (Step 4): run a **second** Codex invocation with a fresh context so the reviewer has not seen your planning:
  `codex exec --model <strongest model you have> "$(cat .lex/audit-1.md)"`
  where `.lex/audit-1.md` is `{{LEX_CORE}}/audit-prompt.md` with PACKET, DIFF, and TEST_OUTPUT filled in. Paste its `VERDICT` back into your reasoning and act on it. If you cannot run a second invocation, do the audit in a separate pass and say that self-review is weaker.
- Escalate per Step 5 and say why in one line.
