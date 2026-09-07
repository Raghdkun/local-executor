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

## A real packet through the executor (two attempts)

The same machine, running a ~2k-token packet ("add `formatSummary` to a 100-line ESM module, against three `node:test` tests") through `run_executor.mjs` 0.2.0. Attempt 1 streamed for 75 s and came back with a nested template literal missing a brace, so the tests failed at parse time. Attempt 2 added a `## Previous attempt failed` section with two numbered fixes; the model changed exactly those two things and the tests passed.

Attempt 1:

```text
$ run_executor --packet packet.md --out .lex/response-1.md --apply --json
Estimated 2028 prompt + 825 output tokens = 2853 of num_ctx 16384.
Time estimate: about 63 s (159 prompt tok/s, 16.5 gen tok/s measured). Run this in the background and do not start a second packet.
  … 1 tokens, 13 s elapsed
  … 137 tokens, 23 s elapsed
  … 268 tokens, 33 s elapsed
  … 388 tokens, 43 s elapsed
  … 512 tokens, 53 s elapsed
  … 639 tokens, 63 s elapsed
  … 776 tokens, 73 s elapsed
Backups of overwritten files: .lex/backups/2026-09-07T16-46-45-607Z
{"ok":true,"files":["src/limiter.mjs"],"created":[],"changed":["src/limiter.mjs"],"unchanged":[],"written":["<repo>/src/limiter.mjs"],"model":"qwen3.5:9b","evalCount":974,"promptEvalCount":2150,"tokensPerSec":15.7,"elapsedSeconds":75,"doneReason":"stop"}
runner exit=0
--- node --test ---
ℹ pass 0
ℹ fail 1
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 33.823667

✖ failing tests:

test at test/limiter.test.mjs:1:1
✖ test/limiter.test.mjs (30.049458ms)
  'test failed'
test exit=0
```

Attempt 2 (retry packet with numbered fixes):

```text
$ run_executor --packet packet-2.md --out .lex/response-2.md --apply --json
Estimated 2401 prompt + 1016 output tokens = 3417 of num_ctx 16384.
Time estimate: about 77 s (159 prompt tok/s, 16.5 gen tok/s measured). Run this in the background and do not start a second packet.
  … 1 tokens, 15 s elapsed
  … 136 tokens, 26 s elapsed
  … 271 tokens, 36 s elapsed
  … 395 tokens, 46 s elapsed
  … 519 tokens, 56 s elapsed
  … 641 tokens, 66 s elapsed
  … 773 tokens, 76 s elapsed
Backups of overwritten files: .lex/backups/2026-09-07T16-49-01-847Z
{"ok":true,"files":["src/limiter.mjs"],"created":[],"changed":["src/limiter.mjs"],"unchanged":[],"written":["<repo>/src/limiter.mjs"],"model":"qwen3.5:9b","evalCount":988,"promptEvalCount":2553,"tokensPerSec":15.6,"elapsedSeconds":79,"doneReason":"stop"}
runner exit=0
--- node --test ---
✔ formatSummary renders one line per limit and a header (0.485083ms)
✔ formatSummary handles an empty log (0.056333ms)
✔ formatSummary never prints negative reset times (0.081458ms)
ℹ pass 3
ℹ fail 0
--- diff attempt1 → attempt2 ---
95c95,97
<   const header = `requests=${summary.requests} success=${summary.successRate === null ? "n/a" : `${Math.round(summary.successRate * 1000) / 1000}%`} p95=${summary.p95Latency === null ? "n/a" : `${summary.p95Latency}ms}`;
---
>   const success = summary.successRate === null ? "n/a" : `${(summary.successRate * 100).toFixed(1)}%`;
>   const p95 = summary.p95Latency === null ? "n/a" : `${summary.p95Latency}ms`;
>   const header = `requests=${summary.requests} success=${success} p95=${p95}`;
```

While attempt 1 was running, a second invocation was refused:

```text
EXECUTOR BUSY: another run_executor (pid 22051) has been running since 2026-09-07T16:45:30.476Z. Ollama serves one request at a time; wait for it, or re-run with --wait to queue.
{"ok":false,"reason":"busy","holder":{"pid":22051,"since":"2026-09-07T16:45:30.476Z"}}
second exit=5
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
