# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/) and versions follow
[Semantic Versioning](https://semver.org/). Entries are generated from
conventional commits by release-please.

## 0.1.0 (unreleased)

### Features

- `lex init` (default command): detects/installs/starts Ollama, detects hardware, recommends and pulls a right-sized model, detects agents, installs the pipeline skill for Claude Code, Codex CLI, Cursor, and Windsurf, and verifies with a real packet.
- `lex doctor`, `lex models`, `lex switch <tag>`, `lex uninstall`.
- Node-only runtime (`run_executor.mjs`, `check_local.mjs`); no Python dependency.
- Model catalog verified against ollama.com on 2026-09-06.
