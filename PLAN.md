# PLAN.md — local-executor (`lex`)

Build order, decisions made where the brief left things open, and the checklist I'm working through.

## Build order

1. `src/models/catalog.ts` + `src/models/recommend.ts` (pure) + tests
2. `src/hardware/detect.ts` (systeminformation → `HardwareProfile`) + tests with mocked `systeminformation`
3. `src/ollama/{client,install,progress}.ts` (fetch-based client, per-OS install plan, `/api/pull` streaming) + tests with mocked `fetch`/`execa`
4. `skill/core/*` (agent-neutral port of the reference skill), `skill/runtime/*.mjs` (Node port; no Python)
5. `skill/adapters/*` + `src/agents/{detect,paths,install}.ts` + `src/util/markers.ts` + tests
6. `src/steps/*` + `src/commands/init.ts` + `src/cli.ts`
7. `doctor`, `models`, `switch`, `uninstall`
8. `README.md`, `docs/GUIDE.md`
9. `.github/workflows/{ci,release}.yml`, `biome.json`, release-please config
10. Real `npx .` dry run → `docs/EXAMPLE_RUN.md`

After each numbered piece: `npm test` and `npm run build` must be green before moving on.

## Decisions the brief left open

| Topic | Decision | Why |
|---|---|---|
| Release tooling | **release-please** | Conventional commits are already mandated, so the changelog and version bump can be derived from history with zero extra files per PR. Changesets wants a `.changeset/*.md` per change, which is friction for a single-package repo. |
| TypeScript version | Latest stable that `tsup` + `vitest` accept at install time (try TS 7, fall back to 5.9 if tooling breaks). `tsup` emits no `.d.ts` (it's a CLI), so the dts pipeline is not a constraint. | Modern-code mandate applies to us too. |
| Shell scripts in the shipped skill | **None.** `run_executor.mjs` and `check_local.mjs` are Node; the Node runtime is guaranteed because the user installed via npm. No `.sh`/`.ps1` pair is needed. `setup_local.sh` from the reference is replaced by `npx local-executor`. | Fewer moving parts; Windows is first-class for free. |
| Where lex keeps its own state | `~/.local-executor/manifest.json` (what was installed where, for `switch`/`uninstall`) and `~/.local-executor/cache/ollama-release.json` (24h cache of the latest release tag). | `uninstall` and `switch` need an authoritative list of touched paths; guessing from agent dirs is fragile. |
| Adapter path rewriting | Adapters are templates with `{{LEX_CORE}}`, `{{LEX_RUNTIME}}`, `{{LEX_CONFIG}}` placeholders, substituted at install time with the real (absolute, `~`-expanded, forward-slash) paths for that agent's install location. | One canonical body, four thin adapters, and every adapter can find `core/` and `runtime/` from wherever it lives. |
| Claude Code install location | User-level `~/.claude/skills/local-executor-pipeline/` by default; if cwd is inside a git repo, also offer project-level `./.claude/skills/local-executor-pipeline/`. `--project` / `--no-project` flags control it non-interactively. | Matches the brief. |
| Codex install location | `~/.codex/local-executor/{core,runtime}` for files; marker-delimited block appended to `~/.codex/AGENTS.md`; if `~/.codex/skills/` exists, also drop a `SKILL.md` there (Codex supports skills now, verified on this machine). | Brief asks for the AGENTS.md block; skills dir is a bonus that costs nothing and is covered by the manifest for uninstall. |
| Cursor / Windsurf | Global copy at `~/.cursor/local-executor/` and `~/.codeium/windsurf/local-executor/`. Project rule file (`.cursor/rules/local-executor.mdc`, `.windsurf/rules/local-executor.md`) written into cwd **when cwd is a git repo** (or `--project` given). Otherwise print how to add it later with `lex init --agents cursor --project`. | Cursor/Windsurf rules are project files; blindly writing into an arbitrary cwd would litter home directories. |
| Executor system prompt | Moved to `skill/core/executor-system-prompt.md` and read at runtime by `run_executor.mjs`; tuned for small models (shorter, format-first, one worked example, explicit "if you cannot, output a single block named `EXECUTOR_CANNOT.md`" so failure is machine-detectable). | Brief item 4. |
| Verify step packet | Language-neutral: a JS file exporting `fortyTwo()` plus a `node --test` file. No test framework needed. | Brief says "write a function that returns 42, with this test"; Node is guaranteed, nothing else is. |
| Model catalog verification | Verified 2026-09-06 by curling `ollama.com/library/<model>/tags`. Sizes recorded from the page and marked approximate. | Brief step 2. |
| CPU-core step-down | "One tier down" is applied until the recommended tag changes, because adjacent tiers can share a top pick (10–14 GB and 14–22 GB both recommend `qwen3.5:9b`). A step-down that changes nothing would be confusing. | Intent of the rule is a lighter model on a weak CPU. |
| `qwen3.5:9b-mlx` | Kept as Apple-only alternative in the 14–22 GB tier as the brief specifies, with the caveat in the reason line that it is 8.9 GB vs 6.6 GB. | Brief table. |
| Ollama install on Linux | Shows the exact `curl -fsSL https://ollama.com/install.sh \| sh` line, asks, runs through `execa('sh', ['-c', ...])`. In `--yes` mode privileged installs are **still confirmed** unless `--yes --allow-install` is passed; without it, `--yes` skips installing and warns. | "Never run privileged installs silently" beats "zero prompts". `--yes` still completes with zero prompts: it just doesn't install Ollama. |
| Downloads > 100 MB in `--yes` mode | Model pulls are always > 100 MB. `--yes` implies consent to pull the recommended model (that is the point of the tool); the size is printed first. `--skip-pull` avoids it. | Otherwise `--yes` could never do anything useful. Documented in README. |
| `lex` with no subcommand | Runs `init`. | Brief. |
| Manifest also records the config.json paths | So `lex switch` updates every install atomically and `lex doctor` checks them all. | Same as above. |
| Exit codes | 0 ok; 1 usage; 2 environment failure (Ollama missing/unreachable); 3 verify failed. `doctor` exits non-zero on any failure. | Scriptability. |

## Out of scope for v1 (called out, not stubbed)

- `lex models --refresh` (live catalog refresh from ollama.com). The catalog is a data file with `lastVerified`; updating it is a PR.
- AMD ROCm VRAM detection beyond what `systeminformation` reports; AMD GPUs are treated as CPU-only for the memory rule unless VRAM is reported.

## Status (2026-09-06)

Built and green (`npm test`: 129 tests, `tsc --noEmit`, `biome check`, `tsup` build):

1. ✅ catalog + recommend (pure, unit-tested, tags verified against ollama.com 2026-09-06)
2. ✅ hardware detect (injected deps, unit-tested)
3. ✅ ollama client / progress / release check / install planner (mocked fetch, unit-tested)
4. ✅ skill core (PIPELINE, handoff template, audit prompt, executor system prompt, modern practices) + Node runtime (`run_executor.mjs`, `check_local.mjs`, config)
5. ✅ four adapters + installer with templating, marker blocks, manifest; isolated end-to-end install/doctor/uninstall verified in a throwaway HOME
6. ✅ `lex init` six steps, `doctor`, `models`, `switch`, `uninstall`, `--json` everywhere
7. ✅ README, docs/GUIDE.md
8. ✅ CI (3 OS × Node 20/22) and release-please + npm publish workflow
9. ✅ real `npx . --yes --skip-pull` on this Mac → docs/EXAMPLE_RUN.md (model pull skipped at the user's request; the 6.6 GB download at ~2 MB/s would have taken about an hour)
