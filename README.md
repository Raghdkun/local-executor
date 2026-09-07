# local-executor (`lex`)

Set up a three-role AI coding pipeline on your machine in one command: a frontier cloud model **plans** and writes the tests, a small open-weight model running locally in Ollama **writes the code**, and a strong cloud model in a fresh context **audits** the result.

```bash
npx local-executor
```

Works on macOS, Linux, and Windows. Installs into Claude Code, Codex CLI, Cursor, and Windsurf.

## What this is

Cloud coding agents are excellent, and every token they spend typing out boilerplate costs the same as a token spent thinking. Most of the tokens in a coding session are the former: filling in a function against a spec, wiring a handler, writing the fourth CRUD endpoint. Local open-weight models can do that work for the price of electricity, but left alone they wander: they refactor what they were not asked to touch, invent APIs, and return prose when you wanted a file.

The idea is to give each model only the job it is good at. The frontier model you already use reads the repo, decides scope, writes the tests first, and packs everything the local model needs into a self-contained **task packet**. The local model gets no tools and no freedom: it turns the packet into code that makes the tests pass. A strong model that has not seen the planning then reviews the diff and answers **ACCEPT** or **REJECT** with concrete issues. Three attempts, then the planner does it itself and says why.

What you get from `npx local-executor`: Ollama installed and running, a model chosen for your hardware and pulled, a measured tokens/sec number, and a skill installed into each of your agents that teaches them the pipeline. From then on you say "use the local executor to implement X" and the agent does the rest.

```
 user request
      │
      ▼
 ┌─────────┐   task packet    ┌──────────────┐   diff + test log   ┌─────────┐
 │ PLANNER │ ───────────────▶ │  EXECUTOR    │ ──────────────────▶ │ AUDITOR │
 │ cloud   │                  │ local, Ollama│                     │ cloud,  │
 │ agent   │                  │ no tools     │                     │ fresh   │
 └─────────┘ ◀─────────────── └──────────────┘ ◀─────────────────  └─────────┘
      ▲          retry with            verdict: ACCEPT / REJECT + reasons
      └──────────────────── apply or loop (max 3) ──────────────────┘
```

## Quick start

```bash
npx local-executor
```

You will be walked through six steps. Each has a header, a one-line explanation, and a flag to skip it.

1. **Ollama.** Detects `ollama` on PATH and the server at `localhost:11434`. Offers to install it (showing the exact command first), starts it if it is stopped, and tells you if a newer release exists. Pick *Skip* at the top if you manage Ollama yourself.
2. **Hardware.** Prints OS, CPU, RAM, GPU, and free disk near the model store, then the "effective memory" number that decides the model tier.
3. **Model.** A ranked list with the recommended tag preselected and every download size shown. Pulls it with live progress, then sends one warm-up request and prints real tokens/sec on your box.
4. **Agents.** Detects Claude Code, Codex CLI, Cursor, and Windsurf and preselects the ones it finds. Pick any subset.
5. **Skill install.** Copies one canonical pipeline body plus a thin adapter per agent, rewriting paths so each adapter finds its scripts.
6. **Verify.** Runs the installed check script and pushes a tiny real packet ("write a function that returns 42, with this test") through the executor.

A non-interactive run on a 16 GB M4 MacBook looks like this (full transcript in [docs/EXAMPLE_RUN.md](docs/EXAMPLE_RUN.md)):

```text
$ npx local-executor --yes
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
~/.claude/skills/local-executor-pipeline: READY · packet pass
~/.codex/local-executor: READY · packet pass
│ ╭─Summary────────────────────────────────────────────────────────────────────╮
│ │  Ollama    v0.33.3 at http://localhost:11434                               │
│ │  Model     qwen3.5:9b — 17.4 tok/s                                         │
│ │  Claude Code user → ~/.claude/skills/local-executor-pipeline               │
│ │  Codex CLI user → ~/.codex/AGENTS.md                                       │
│ │  Verify    2/2 install(s) passed the end-to-end packet                     │
│ ╰────────────────────────────────────────────────────────────────────────────╯
│
```

## Updating

`lex init` is idempotent, so updating on any machine that already has the tool is one command:

```bash
npx local-executor@latest --yes
```

It rewrites the files it owns (pipeline docs, runtime scripts, adapters) in every agent it finds, re-measures speed, and keeps your `config.json` edits and your model. Use the explicit `@latest`; plain `npx local-executor` can reuse an older copy from the npx cache. Add `--skip-pull` to leave models alone and `--skip-verify` to skip the end-to-end packet. If you installed globally, `npm i -g local-executor@latest && lex --yes` (prefix the `npm i -g` with `sudo` when your global prefix is root-owned, as `/usr/local` is with the macOS Node installer; `npx` needs no such thing). `lex doctor` shows what is installed; the first lines of each installed `SKILL.md` name the version that wrote it.

## Which model will I get?

The decision is driven by **effective memory**: the memory a model can realistically occupy once the OS, your editor, and your agent have theirs.

- **Apple Silicon**: 70% of unified memory. A 16 GB Mac has about 11 GB.
- **PC with a discrete NVIDIA or AMD GPU**: the card's VRAM. System RAM does not count.
- **CPU only**: 50% of RAM. Below 4 physical cores, one tier smaller than the table says, because a bigger model would be too slow to use.

| Effective memory | Recommended | Also offered | Why |
|---|---|---|---|
| under 6 GB | `qwen3.5:2b` (2.7 GB) | `gemma4:e2b` | Very tight; short packets only |
| 6–10 GB | `qwen3.5:4b` (3.4 GB) | `gemma4:e4b` | Light and fast; good for small tasks |
| 10–14 GB (16 GB Mac) | `qwen3.5:9b` (6.6 GB) | `granite4.2:8b`, `gemma4:e4b`, `qwen3.5:4b` | Best code quality that fits |
| 14–22 GB (24 GB Mac, 16 GB VRAM PC) | `qwen3.5:9b` | `gemma4:e4b`, `qwen3.5:9b-mlx` (Apple) | 9B at Q4 fits with headroom |
| 22–30 GB (32 GB Mac) | `qwen3.8:27b` (18 GB) | `gemma4:26b`, `qwen3.5:9b`, `devstral` | Newest 27B dense fits; strong coding |
| 30–48 GB | `qwen3.6:35b-a3b` (23 GB) | `qwen3.8:27b`, `gemma4:26b`, `gemma4:31b` | Frontier-adjacent local coding |
| 48 GB and up | `qwen3.6:35b-a3b` | `gemma4:31b`, `qwen3.6:35b-a3b-coding`, `qwen3.6:27b-coding` | Room for big context |

Sizes are approximate download sizes from ollama.com. The recommended tag must also fit on disk with a 1.5× margin; if it does not, `lex` steps down and says so.

**Why a 26B mixture-of-experts model does not fit on 16 GB even though only 4B parameters are "active":** active parameters describe how much compute each token needs, which is why MoE models are fast. Memory is decided by total parameters, because the router can pick any expert for the next token and they all have to be resident. Gemma 4 26B is a 19 GB download and needs all of it in memory.

`lex models` prints this table ranked for your machine without installing anything. `lex models --refresh` goes to ollama.com and reports catalog tags that vanished, sizes that drifted, newer tags in the catalog families, and the newest coding-capable families the catalog does not know yet; the skill tells agents to run it when the last check is more than two weeks old, so the recommendation keeps pointing at current models between releases of this tool. The catalog lives in [`src/models/catalog.ts`](src/models/catalog.ts) and records when its tags were last checked against ollama.com.

## Using it from each agent

The trigger phrases are the same everywhere: "use the local executor", "use the local model", "hand this to the executor", "run the pipeline".

### Claude Code

Installed as a user-level skill at `~/.claude/skills/local-executor-pipeline/` (and a project-level copy under `./.claude/skills/` if you said yes inside a repo).

> Use the local executor to implement `parseDuration(input: string): number` in `src/time.ts`. It should accept "1h30m", "45s", "2d" and throw on anything else.

Claude reads the repo, lists the skills and MCP tools it will use, writes `test/time.test.ts` first, writes a packet with your existing `src/time.ts` pasted in, runs `run_executor.mjs`, runs the tests, then spawns an Opus subagent with the audit prompt. You see a short report: what changed, how many attempts, what the auditor flagged.

### Codex CLI

Installed as a marker-delimited block in `~/.codex/AGENTS.md` plus scripts under `~/.codex/local-executor/`. If `~/.codex/skills/` exists, a `SKILL.md` is added there too. Inside a repo, the same block is appended to the project's `AGENTS.md`.

> Use the local executor pipeline to add a `--dry-run` flag to `cmd/sync.go`. Write the tests first.

Codex plans and writes the tests, runs the executor, then runs a second `codex exec` invocation with the audit prompt so the reviewer has a fresh context. The executor script only talks to `127.0.0.1:11434`; if the sandbox blocks it, Codex asks for approval for that one command.

### Cursor

A project rule at `.cursor/rules/local-executor.mdc` (written when you run `lex` inside a repo, or with `--project`) that points at scripts in `~/.cursor/local-executor/`.

> Use the local executor pipeline to implement the `RateLimiter` class in `lib/rate_limiter.py` against the spec in `docs/rate-limiting.md`.

Cursor cannot spawn subagents, so for the audit it tells you it is opening a fresh chat, pastes the audit prompt there, and brings the verdict back.

### Windsurf

A project rule at `.windsurf/rules/local-executor.md` pointing at `~/.codeium/windsurf/local-executor/`. Same flow as Cursor: Cascade plans and executes in one conversation and audits in a new one.

## How the pipeline works

The full rules are in [`skill/core/PIPELINE.md`](skill/core/PIPELINE.md); this is the shape.

**Task packets.** The executor sees one Markdown document and nothing else: Goal, Files you may change, Conventions (including a mandatory *modern practices* block for the language, from [`modern-practices.md`](skill/core/modern-practices.md)), the existing code pasted verbatim, the tests pasted verbatim with the exact command that must pass, and a concrete *Do NOT* list. Format in [`handoff-template.md`](skill/core/handoff-template.md).

**The agent chooses the models.** Before planning, the skill has the agent decide three things: plan on the strongest, newest model its environment offers (and say so if it is running as a "fast" tier); audit on the newest frontier model in a fresh context (Claude Code's `model: "opus"` alias, Codex's newest reasoning model at high effort, the newest model in Cursor's or Windsurf's picker, never "auto"); and pick the executor **per packet** with `--model`: the smaller `fallback_model` for mechanical work, the installed default for standard packets, the largest pulled model that fits for hard logic. Nothing is pulled without asking, and the final report says which model did what. `lex models --refresh` keeps the local side current (below).

**Tests first.** The planner writes the tests and puts them in the repo before the executor sees anything. This is the single biggest lever on quality: a small model cannot argue with a failing test. Test files may be excerpted in the packet (the executor never edits them); files the executor will change must be pasted in full, because it returns whole files.

**Inventory.** Before planning, the agent lists the skills and MCP tools on the machine that help with this task and says which it will use. The executor never gets tools; the planner uses them to write a better packet.

**Execution.** `run_executor.mjs` streams the packet to Ollama with the system prompt in [`executor-system-prompt.md`](skill/core/executor-system-prompt.md), which forces fenced code blocks tagged with file paths and nothing else. Thinking mode is off. Paths that escape the repo are refused. A packet takes minutes on a laptop (a 9B model generates 10–20 tokens/s and a full file is 1–3k tokens), so the runner prints progress, holds a lock so only one packet runs per server, checks the token budget against `num_ctx` before sending, and diffs the reply against the files on disk. Distinct exit codes tell the planner what happened:

| Exit | Meaning |
|---|---|
| 0 | Files returned (and written, with `--apply`) |
| 2 | Ollama or network error; the message names the cause |
| 3 | No code blocks in the reply |
| 4 | The model declared it cannot do the task |
| 5 | Executor busy: another packet is running (`--wait` queues instead) |
| 6 | Every returned file is byte-identical to disk, which is never a valid result |

`--dry-run` prints the token estimate, the budget verdict, and the expected duration without sending anything. Backups of overwritten files go under `<repo>/.lex/backups/`, and the runner writes `.lex/.gitignore` so nothing in `.lex/` is committed.

**The audit contract.** Only after tests pass. The auditor is never the local model and never the context that wrote the packet. It answers `VERDICT: ACCEPT | REJECT`, a numbered list of issues tagged `blocker | major | minor`, and `MISSING TESTS`. Any blocker is a reject. Prompt in [`audit-prompt.md`](skill/core/audit-prompt.md).

**Retries name the fix.** A retry packet carries a numbered "fix exactly these, nothing else" list (symbol, what is wrong, the exact replacement) plus the trimmed failure. That is the form small models follow; raw test output alone tends to produce the same file again, which the runner now rejects.

**Three attempts, then escalate.** Test failures and audit rejects both count. After three, or when a packet would exceed about 6,000 tokens of pasted code, or when the executor returns prose twice in a row, the planner does the task itself and logs one line saying why. The local model is a cost saver, not a replacement.

**When to skip it.** One-line fixes, renames, anything faster to do than to describe. The skill says so explicitly.

## Flags and non-interactive use

`lex` with no subcommand runs `init`. Every prompt has a flag; `lex --yes` completes with zero prompts.

| Flag | Applies to | Meaning |
|---|---|---|
| `-y, --yes` | init, switch, uninstall | Accept defaults, never prompt. Implies consent to pull the chosen model. |
| `--json` | all | Machine-readable output on stdout, nothing else. Implies `--yes`. |
| `-m, --model <tag>` | init | Use this Ollama tag instead of asking. |
| `-a, --agents <list>` | init, uninstall | Comma-separated subset of `claude,codex,cursor,windsurf`. |
| `--skip-ollama` | init | Do not detect, install, or start Ollama. Later steps still check the server and warn. |
| `--skip-pull` | init | Record the model in config but do not download it. |
| `--skip-verify` | init | Do not run the end-to-end packet. |
| `--project` / `--no-project` | init | Force or forbid project-level files (needs a git repo). Default: ask, preselected when Cursor or Windsurf is chosen. |
| `--allow-install` | init | In `--yes` mode, permit running the Ollama install or upgrade command. Without it, `--yes` prints the command and moves on. |
| `--ollama-url <url>` | init, doctor, switch | Ollama server; also read from `OLLAMA_HOST`. |
| `--all` | models | Include models that do not fit in memory. |
| `--refresh` | models | Check ollama.com live for newer tags and families; prints a report, changes nothing. |
| `-v, --version`, `-h, --help` | | |

Exit codes: `0` ok, `1` usage or a failed `doctor` check, `2` Ollama unreachable when it was required, `3` verification failed, `130` cancelled.

```bash
# CI-style: no prompts, no privileged installs, nothing downloaded
lex init --json --skip-ollama --skip-pull --skip-verify --agents claude

# Developer laptop, one line
lex --yes --allow-install
```

Other commands:

- `lex doctor` re-runs every check and prints a table; exits 1 on any failure.
- `lex models` shows the catalog ranked for this machine.
- `lex switch <tag>` pulls the tag if needed, measures speed, and updates every installed `config.json`.
- `lex uninstall [--agents …]` removes what was installed, editing (not deleting) shared files like `AGENTS.md`.

## Configuration

Each install has its own `runtime/config.json`, read by the scripts next to it:

| Agent | Config path |
|---|---|
| Claude Code (user) | `~/.claude/skills/local-executor-pipeline/runtime/config.json` |
| Claude Code (project) | `<repo>/.claude/skills/local-executor-pipeline/runtime/config.json` |
| Codex CLI | `~/.codex/local-executor/runtime/config.json` |
| Cursor | `~/.cursor/local-executor/runtime/config.json` |
| Windsurf | `~/.codeium/windsurf/local-executor/runtime/config.json` |

| Field | Default | Meaning |
|---|---|---|
| `ollama_url` | `http://localhost:11434` | Where the server listens. |
| `model` | chosen at install | Executor tag. Change with `lex switch <tag>`. |
| `fallback_model` | chosen at install (a smaller model in the same family) | Used by agents for mechanical packets via `--model`. Not pulled automatically; `check_local.mjs` says whether it is. |
| `num_ctx` | `16384`, or `32768` on machines with 12 GB+ of headroom above the model file | Context window in tokens. The runner refuses packets that cannot fit and warns above 85%. Halve it before stepping down a model size if memory is tight. |
| `temperature` | `0.1` | Low on purpose; executors should be boring. |
| `keep_alive` | `"30m"` | How long Ollama keeps the model loaded after a request. |
| `timeout_seconds` | `600` | Per-request timeout for the executor. |
| `think` | `false` | Disables Qwen/Gemma thinking mode so tokens go to code. |
| `benchmark` | measured at install | Prompt and generation tokens/s for `model`, from a 2k-token probe. `check_local.mjs` and `run_executor.mjs` use it to print "about N min per packet". Refresh with `check_local.mjs --bench`; dropped automatically when the model changes. |

Re-running `lex init` keeps your edits to fields other than `model` and `ollama_url`. `lex` keeps its own bookkeeping in `~/.local-executor/manifest.json` (what was installed where) and a 24-hour cache of the latest Ollama release tag; set `LEX_HOME` to move that directory.

## Troubleshooting

**Ollama not reachable.** `lex doctor` says `ollama server: not reachable`. Open the Ollama app (macOS/Windows) or run `ollama serve` in a terminal. If you run Ollama on another machine or port, pass `--ollama-url` or set `OLLAMA_HOST`; `lex` writes it into each config.

**`EXECUTOR ERROR: fetch failed` on real packets while `check_local` says READY.** Versions before 0.2.0 sent non-streaming requests, and Node's fetch gives up waiting for headers after about five minutes, which a 9B model easily exceeds on a 4k-token packet. Update (`npx local-executor@latest --yes` re-installs the runtime) — the runner now streams, prints progress every 10 s, and names the underlying cause code in any error.

**`EXECUTOR BUSY` (exit 5).** Ollama serves one request at a time; a second packet would silently wait. Run packets one at a time, or pass `--wait` to queue.

**Exit 6, "returned files unchanged".** The model handed back the file it was given. Retry with the numbered "fix exactly these" list from the handoff template rather than raw test output; after that, escalate.

**Packets take 5–10 minutes.** Normal for a 9B model on a laptop: `check_local.mjs` prints the measured estimate. Agents should run the executor in the background (the Claude Code adapter says so explicitly; a default 2-minute tool timeout kills it mid-generation). To speed up: a smaller model for mechanical packets (`lex switch qwen3.5:4b`), or smaller packets.

**Slow, or the model keeps reloading.** Watch memory while a packet runs: macOS Activity Monitor → Memory → the *Memory Pressure* graph (yellow or red means swapping); Windows Task Manager → Performance → GPU → *Dedicated GPU memory* (full means spilling to RAM). Fixes in order: close other GPU/memory-hungry apps; set `num_ctx` to `8192` in `config.json`; `lex switch` to the next tier down. A model that swaps runs at 1–2 tokens/sec, which is worse than a smaller one that fits.

**The executor returns prose instead of code.** Usually the packet is too vague or too large. Make the Goal one paragraph, paste the full existing file, and keep tests small. The system prompt already forbids prose; when a model ignores it twice, the skill tells the planner to escalate. Very small models (2B) do this more; try the 4B tag.

**The audit keeps rejecting.** Read the issues: if they are about the packet (missing convention, inadequate tests), the skill says to fix the packet rather than retry. If they are about the same coding mistake every time, the model is under-sized for the task; `lex models` and step up, or let the planner do that packet.

**Pull fails with "file does not exist".** The tag is wrong. Check ollama.com/library for the exact name; tags change between releases. The catalog records when it was last verified.

**`lex doctor` says files are missing.** Re-run `lex init`; it is idempotent and only rewrites its own files.

## Security & privacy

- **Nothing leaves your machine for the executor.** `run_executor.mjs` and `check_local.mjs` talk only to the Ollama URL in `config.json`, which defaults to localhost. Ollama itself downloads model files from ollama.com when you pull.
- **Planner and auditor calls go to whichever cloud agent you already use.** `lex` adds no service of its own and has no telemetry. The only network requests the installer makes are to the Ollama server and, once a day, to the GitHub releases API to compare Ollama versions (fails quietly offline).
- **What the installer writes:** the skill directories listed under Configuration, a marker-delimited block in `~/.codex/AGENTS.md` (and a project `AGENTS.md` if you opt in), rule files under `.cursor/rules/` and `.windsurf/rules/` if you opt in, and `~/.local-executor/`. `lex uninstall` reverses exactly that list.
- **Privileged commands are never run silently.** The Ollama install and upgrade commands are printed with an explanation and require a yes; in `--yes` mode they are skipped unless you pass `--allow-install`. Downloads over 100 MB are announced with their size.
- **The executor cannot write outside the repo.** Paths returned by the model are checked against `--root`; absolute paths and `..` escapes are refused and reported. Existing files get a `.bak` before being overwritten.

## Contributing / updating the model catalog

The catalog is a data file: [`src/models/catalog.ts`](src/models/catalog.ts). To add or change a model:

1. Open `https://ollama.com/library/<family>/tags` and copy the exact tag and the size shown.
2. Add a `CatalogModel` entry with `tag`, `family`, `params`, `sizeGB`, `contextK`, and a one-line `notes`. Set `appleOnly: true` for MLX builds.
3. If it should be a tier's pick, edit `tiers`. Tiers must stay contiguous from 0 to Infinity; the tests enforce it and that every referenced tag exists.
4. Update `lastVerified` to today's date. It is printed by `lex models` and written into every generated `models.md`.
5. `npm test`.

Commits follow Conventional Commits; release-please opens a release PR, and merging it tags a release and publishes to npm through [trusted publishing](https://docs.npmjs.com/trusted-publishers) (no token secret; the package's npmjs.com settings name this repo and `release.yml` as the trusted publisher). CI runs lint, typecheck, tests, and build on macOS, Linux, and Windows with Node 20 and 22, plus an isolated `init`/`uninstall` against a throwaway home directory.

Dependencies, and why each one is here: `@clack/prompts` (the interactive UI), `commander` (argument parsing), `systeminformation` (CPU/RAM/GPU/disk on all three OSes), `picocolors` (colors, tiny), `execa` (every process we spawn, no shell strings). Dev: `tsup`, `vitest`, `@biomejs/biome`, `typescript`.

## License

MIT. See [LICENSE](LICENSE).
