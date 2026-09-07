# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/) and versions follow
[Semantic Versioning](https://semver.org/). Entries are generated from
conventional commits by release-please.

## [0.1.1](https://github.com/Raghdkun/local-executor/compare/v0.1.0...v0.1.1) (2026-09-07)


### Bug Fixes

* **ci:** platform-agnostic path expectations in tests; publish via npm trusted publishing ([e01e05c](https://github.com/Raghdkun/local-executor/commit/e01e05c25415e965f3744d1120d7a3d3582d8726))
* **ci:** support Node 20 (execa 9) and force LF line endings for Windows checkouts ([33b05cb](https://github.com/Raghdkun/local-executor/commit/33b05cbfc09ab095bbfe7d018e679a8c333f6778))

## 0.1.0 (unreleased)

### Features

- `lex init` (default command): detects/installs/starts Ollama, detects hardware, recommends and pulls a right-sized model, detects agents, installs the pipeline skill for Claude Code, Codex CLI, Cursor, and Windsurf, and verifies with a real packet.
- `lex doctor`, `lex models`, `lex switch <tag>`, `lex uninstall`.
- Node-only runtime (`run_executor.mjs`, `check_local.mjs`); no Python dependency.
- Model catalog verified against ollama.com on 2026-09-06.
