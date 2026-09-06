# Example run

A real, unedited run of `local-executor` on the machine it was developed on: a 16 GB Apple M4 MacBook, macOS, Node 24, Ollama 0.33.3 already installed and running, Claude Code and Codex CLI present, Cursor and Windsurf absent. Recorded on 2026-09-06 with stdout piped to a file, which is why prompts are auto-answered (non-TTY runs behave like `--yes`) and spinners print as plain lines. ANSI colors were stripped and the home directory replaced with `~`.

The model pull was skipped with `--skip-pull` at the author's request (the 6.6 GB download was running at about 2 MB/s on this connection). Because the model is absent, step 6 reports `MISSING MODEL` and the end-to-end packet is skipped rather than failed; `lex doctor` shows the same two failing checks with the exact command that fixes them. A run with the model present ends with `READY · packet pass` and a measured tokens/sec figure in the summary.

## `npx . --yes --skip-pull`

```text
$ npx . --yes --skip-pull
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
◇  2/6 Hardware
│  What this machine can run. Effective memory decides the model tier.
Detecting CPU, memory, GPU, and disk…
Hardware detected.
│
│  OS         darwin (arm64)
│  CPU        Apple M4, 10 cores (10 threads)
│  RAM        16 GB total, 5.9 GB free
│  GPU        Apple Silicon (unified memory)
│  Free disk  22.7 GB on the volume holding ~/.ollama/models
│
●  Effective memory for models: 11.2 GB (Apple Silicon: 70% of 16 GB unified memory) → tier 10–14 GB
│
◆  Recommended: qwen3.5:9b (~6.6 GB) — Best code quality that fits
│
◇  3/6 Model
│  Pick the executor model, pull it, and measure real tokens/sec on this machine.
│
▲  --skip-pull: not pulling qwen3.5:9b. Run: ollama pull qwen3.5:9b
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
│    Wrote ~/.codex/skills/local-executor-pipeline/SKILL.md
│
│    Appended lex block in ~/.codex/AGENTS.md
│
●  Install manifest: ~/.local-executor/manifest.json
│
◇  6/6 Verify
│  Run the installed check script and push one tiny real packet through the executor.
Checking ~/.claude/skills/local-executor-pipeline…
~/.claude/skills/local-executor-pipeline: MISSING MODEL — qwen3.5:9b not pulled. Run: ollama pull qwen3.5:9b
Checking ~/.codex/local-executor…
~/.codex/local-executor: MISSING MODEL — qwen3.5:9b not pulled. Run: ollama pull qwen3.5:9b
│ ╭─Summary────────────────────────────────────────────────────────────────────╮
│ │  Ollama    v0.33.3 at http://localhost:11434                               │
│ │  Model     qwen3.5:9b — not pulled                                         │
│ │  Claude Code user → ~/.claude/skills/local-executor-pipeline               │
│ │  Codex CLI user → ~/.codex/AGENTS.md                                       │
│ │  Verify    not run (2 skipped: missing model)                              │
│ ╰────────────────────────────────────────────────────────────────────────────╯
│
▲  Model qwen3.5:9b not pulled (--skip-pull).
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

## `lex doctor` afterwards

```text
$ lex doctor
┌   lex doctor 
│
│  ollama binary       ok    /usr/local/bin/ollama
│  ollama server       ok    v0.33.3 at http://localhost:11434
│  ollama version      ok    up to date (v0.33.3)
│  install manifest    ok    2 install(s) in ~/.local-executor/manifest.json
│  claude/user files   ok    ~/.claude/skills/local-executor-pipeline
│  claude/user model   FAIL  qwen3.5:9b not pulled — run: ollama pull qwen3.5:9b
│  codex/user files    ok    ~/.codex/local-executor
│  codex/user model    FAIL  qwen3.5:9b not pulled — run: ollama pull qwen3.5:9b
│  codex/user adapter  ok    ~/.codex/skills/local-executor-pipeline
│  codex/user block    ok    ~/.codex/AGENTS.md
│
└  2 check(s) failed.

exit=1
```

## `lex models`

```text
$ lex models
┌   lex models 
│
│  OS         darwin (arm64)
│  CPU        Apple M4, 10 cores (10 threads)
│  RAM        16 GB total, 6 GB free
│  GPU        Apple Silicon (unified memory)
│  Free disk  22.7 GB on the volume holding ~/.ollama/models
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

## `lex uninstall --yes` (run before the transcript above, to start from a clean machine)

```text
$ lex uninstall --yes
┌   lex uninstall 
│
◇  This will ──────────────────────────────────────────╮
│                                                      │
│  Claude Code (user)                                  │
│    delete  ~/.claude/skills/local-executor-pipeline  │
│  Codex CLI (user)                                    │
│    delete  ~/.codex/local-executor                   │
│    delete  ~/.codex/skills/local-executor-pipeline   │
│    unmark  ~/.codex/AGENTS.md (block only)           │
│                                                      │
├──────────────────────────────────────────────────────╯
│
◆  Removed ~/.claude/skills/local-executor-pipeline
│
◆  Removed ~/.codex/local-executor
│
◆  Removed ~/.codex/skills/local-executor-pipeline
│
◆  Removed lex block from ~/.codex/AGENTS.md
│
└  Removed 2 install(s). Ollama and pulled models were left alone.

exit=0
```
