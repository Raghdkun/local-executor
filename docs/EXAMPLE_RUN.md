# Example run

A real, unedited run of the published package on the machine it was developed on: a 16 GB Apple M4 MacBook, macOS, Node 24, Ollama 0.33.3 running with `qwen3.5:9b` already pulled, Claude Code and Codex CLI present, Cursor and Windsurf absent. Recorded on 2026-09-07 with stdout piped to a file, which is why prompts are auto-answered (non-TTY runs behave like `--yes`) and spinners print as plain lines. It was run against a throwaway `HOME` so the author's real install stayed untouched; that path is shown as `~`. ANSI colors were stripped.

The model was already present, so step 3 skips the download and goes straight to the warm-up measurement. Step 6 sends the "return 42" packet through the executor once per installed runtime and runs the test with `node --test`.

## `npx local-executor@0.1.0 init --yes`

```text
$ npx -y local-executor@0.1.0 init --yes
┌   local-executor v0.1.0 
│
│  Planner (your cloud agent) → Executor (local model via Ollama) → Auditor (strong model, fresh context).
│
◇  1/6 Ollama
│  The local server that runs the executor model. Detect, install, start, and check the version.
│
◆  Ollama 0.33.3 is running at http://localhost:11434.
│
●  Ollama is up to date (latest release: v0.33.3).
│
●  Model store will be created at ~/.ollama/models on first pull.
│
◇  2/6 Hardware
│  What this machine can run. Effective memory decides the model tier.
Detecting CPU, memory, GPU, and disk…
Hardware detected.
│
│  OS         darwin (arm64)
│  CPU        Apple M4, 10 cores (10 threads)
│  RAM        16 GB total, 1.9 GB free
│  GPU        Apple Silicon (unified memory)
│  Free disk  17.4 GB on the volume holding ~/.ollama/models
│
●  Effective memory for models: 11.2 GB (Apple Silicon: 70% of 16 GB unified memory) → tier 10–14 GB
│
◆  Recommended: qwen3.5:9b (~6.6 GB) — Best code quality that fits
│
◇  3/6 Model
│  Pick the executor model, pull it, and measure real tokens/sec on this machine.
│
◆  qwen3.5:9b is already pulled.
Loading qwen3.5:9b and measuring speed (first load can take 10–30 s)…
qwen3.5:9b ready: 17.4 tok/s (load 4 s, 64 tokens generated)
│
◇  4/6 Agents
│  Which AI coding agents should learn the pipeline. Detected ones are preselected.
│
◆  Claude Code: claude on PATH, ~/.claude exists
│
◆  Codex CLI: ~/.codex exists
│
│  Cursor: not detected
│
│  Windsurf: not detected
│
◇  5/6 Skill install
│  One canonical pipeline body plus a thin adapter per agent, with paths rewritten for each location.
│
◆  Claude Code user-level skill
│
│    Created ~/.claude/skills/local-executor-pipeline
│
│    Wrote ~/.claude/skills/local-executor-pipeline/SKILL.md
│
◆  Codex CLI global instructions block + scripts
│
│    Created ~/.codex/local-executor
│
│    Appended lex block in ~/.codex/AGENTS.md
│
●  Install manifest: ~/.local-executor/manifest.json
│
◇  6/6 Verify
│  Run the installed check script and push one tiny real packet through the executor.
Checking ~/.claude/skills/local-executor-pipeline…
  Sending the "return 42" packet through ~/.claude/skills/local-executor-pipeline…
~/.claude/skills/local-executor-pipeline: READY · packet pass
Checking ~/.codex/local-executor…
~/.codex/local-executor: READY · packet pass
│ ╭─Summary────────────────────────────────────────────────────────────────────╮
│ │  Ollama    v0.33.3 at http://localhost:11434                               │
│ │  Model     qwen3.5:9b — 17.4 tok/s                                         │
│ │  Claude Code user → ~/.claude/skills/local-executor-pipeline               │
│ │  Codex CLI user → ~/.codex/AGENTS.md                                       │
│ │  Verify    2/2 install(s) passed the end-to-end packet                     │
│ ╰────────────────────────────────────────────────────────────────────────────╯
│
◇  How to start ──────────────────────────────────────────────────────────╮
│                                                                         │
│  • In Claude Code, say: "use the local executor to implement X"         │
│  • In Codex CLI, say: "use the local executor pipeline to implement X"  │
│                                                                         │
├─────────────────────────────────────────────────────────────────────────╯
│
└  Done.

exit=0
```

## `lex doctor` on the real install

```text
$ lex doctor
┌   lex doctor 
│
│  ollama binary       ok    /usr/local/bin/ollama
│  ollama server       ok    v0.33.3 at http://localhost:11434
│  ollama version      ok    up to date (v0.33.3)
│  install manifest    ok    2 install(s) in ~/.local-executor/manifest.json
│  claude/user files   ok    ~/.claude/skills/local-executor-pipeline
│  claude/user model   ok    qwen3.5:9b pulled
│  codex/user files    ok    ~/.codex/local-executor
│  codex/user model    ok    qwen3.5:9b pulled
│  codex/user adapter  ok    ~/.codex/skills/local-executor-pipeline
│  codex/user block    ok    ~/.codex/AGENTS.md
│
└  All checks passed.

exit=0
```

## `lex models`

```text
$ lex models
┌   lex models 
│
│  OS         darwin (arm64)
│  CPU        Apple M4, 10 cores (10 threads)
│  RAM        16 GB total, 1.6 GB free
│  GPU        Apple Silicon (unified memory)
│  Free disk  16.4 GB on the volume holding ~/.ollama/models
│
●  Effective memory: 11.2 GB (Apple Silicon: 70% of 16 GB unified memory) → tier 10–14 GB
│
│  ★ qwen3.5:9b      ~ 6.6 GB  Best code quality that fits
│    gemma4:e4b      ~ 9.6 GB  Solid instruction following; heavier download than qwen3.5:4b.
│    qwen3.5:4b      ~ 3.4 GB  Light and fast; good for small, well-specified tasks.
│    qwen3.5:9b-mlx  ~ 8.9 GB  Apple Silicon only; faster than the GGUF build, needs ~2 GB more memory.
│    gemma4:12b      ~ 7.6 GB  Dense 12B; a good middle ground when 9B is not enough.
│    gemma4:e2b      ~ 7.2 GB  Fast on CPU; larger download than its active size suggests.
│    qwen3.5:2b      ~ 2.7 GB  Smallest usable executor; keep packets short and single-file.
│
└  Catalog last verified against ollama.com on 2026-09-06. Nothing was installed. Use --all to include models that do not fit.
```
