---
name: local-executor-pipeline
description: Plan and write tests here, let a local Ollama model ({{LEX_MODEL}}) write the code, then audit with a fresh reviewer pass. Use when the user says "use the local model", "use the local executor", "run the pipeline", or wants to save cloud tokens on implementation work.
---

Read `{{LEX_CORE}}/PIPELINE.md` and the "Local executor pipeline" section of `~/.codex/AGENTS.md`, then follow them. Scripts: `{{LEX_RUNTIME}}/check_local.mjs`, `{{LEX_RUNTIME}}/run_executor.mjs`. Config: `{{LEX_CONFIG}}`.
