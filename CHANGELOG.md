# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/) and versions follow
[Semantic Versioning](https://semver.org/). Entries are generated from
conventional commits by release-please.

## [0.3.0](https://github.com/Raghdkun/local-executor/compare/v0.2.0...v0.3.0) (2026-09-07)


### Features

* agent-driven model choice, live catalog refresh, newest verified models ([632165a](https://github.com/Raghdkun/local-executor/commit/632165a51c0c4180702a2becce7766156967eac5))


### Bug Fixes

* **test:** expectations for catalog date, refresh, and fallback picker ([50ac9a6](https://github.com/Raghdkun/local-executor/commit/50ac9a6e3916505e88ea7dcdcabdbf53e7bd20f2))


### Documentation

* add Updating section to README ([1a8da27](https://github.com/Raghdkun/local-executor/commit/1a8da2799919306f83fd51f742c8f86628b89835))
* note sudo for root-owned global npm prefix in Updating ([f2fb16d](https://github.com/Raghdkun/local-executor/commit/f2fb16d06b61bd40260c6aedf01c999992efa128))
* real two-attempt packet transcript in EXAMPLE_RUN.md ([b0843b7](https://github.com/Raghdkun/local-executor/commit/b0843b771434376ed8df3df4f7c852a57d1609fc))

## [0.2.0](https://github.com/Raghdkun/local-executor/compare/v0.1.1...v0.2.0) (2026-09-07)


### Features

* **runtime:** stream executor requests, lock, budget checks, benchmark, unchanged detection ([56917b6](https://github.com/Raghdkun/local-executor/commit/56917b668849bb229e302a40223e18a14807635c))

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
