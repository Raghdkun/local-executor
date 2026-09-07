---
trigger: model_decision
description: Local executor pipeline — plan and write tests in Windsurf, let a local Ollama model ({{LEX_MODEL}}) write the code, audit in a fresh conversation. Apply when the user says "use the local model", "use the local executor", "run the pipeline", or wants to save cloud tokens on implementation work.
---

# Local executor pipeline (Windsurf adapter, installed by local-executor v{{LEX_VERSION}})

Read `{{LEX_CORE}}/PIPELINE.md` and follow it. You are the **planner**. The local model writes code; you never let it plan or decide scope.

Windsurf-specific notes:

- Run scripts in the terminal:
  `node "{{LEX_RUNTIME}}/check_local.mjs"` (add `--bench` once per model to measure speed)
  `node "{{LEX_RUNTIME}}/run_executor.mjs" --packet .lex/packet-1.md --dry-run`
  `node "{{LEX_RUNTIME}}/run_executor.mjs" --packet .lex/packet-1.md --out .lex/response-1.md`
  The executor takes minutes per packet; run it in a terminal you can leave open, one packet at a time (exit 5 means one is already running). The runner creates `.lex/.gitignore` so packets and backups stay out of git.
- Inventory (Step 1): other rules in `.windsurf/rules/`, workflows in `.windsurf/workflows/`, and MCP servers configured in Windsurf. Use a docs MCP to get exact API facts into the packet.
- Audit (Step 4): Cascade cannot spawn a subagent. Tell the user: "Starting a new conversation for the audit so the reviewer has not seen my planning." Then open a **new Cascade conversation** with the strongest available model, paste `{{LEX_CORE}}/audit-prompt.md` with PACKET, DIFF, and TEST_OUTPUT filled in, and bring the `VERDICT` back here. Do not audit in this conversation unless the user declines; if so, say self-review is weaker.
- Escalate per Step 5 and say why in one line.
- Config: `{{LEX_CONFIG}}`. Change the model with `lex switch <tag>`, not by editing rules.
