# Modern-practices blocks

Paste the block for the target language into the packet's **Conventions → Modern practices** list. Adjust versions to what the repo actually uses (check `package.json`, `pyproject.toml`, `go.mod`, `Cargo.toml`, `*.csproj`, `Package.swift`). If the repo is older than the versions below, say so in the packet and pin to the repo's version; do not let the executor "upgrade" the project. Last reviewed: 2026-09-06.

Every block is short on purpose: a small model follows five concrete bullets better than a page of guidance. Add one or two repo-specific bullets (formatter, import order, logging library) and stop.

## TypeScript / JavaScript
- TypeScript ≥ 5.9 (7.x if the repo uses it), `strict: true`. ESM (`import`/`export`), not CommonJS, unless the repo is CJS.
- No `any`. Use `unknown` + narrowing, or precise types. No non-null assertions (`!`) without a comment.
- `async`/`await`; never unhandled promises. Errors are thrown or returned as typed results, not swallowed.
- Prefer `const`; no `var`. Optional chaining and nullish coalescing over manual checks.
- Node ≥ 20 APIs: `fetch`, `node:fs/promises`, `node:path`, `structuredClone`. No `request`, no callbacks-style fs.
- Tests: vitest or the repo's runner. Named exports. No default exports for libraries.

## Python
- Python ≥ 3.12 (3.11 minimum). Type hints on every function signature; `list[str]` / `X | None`, not `List`/`Optional`. `from __future__ import annotations` if the repo targets 3.9/3.10.
- Dataclasses or Pydantic for structured data, not dicts passed around.
- `pathlib.Path`, not `os.path`. f-strings, not `%` or `.format()`.
- Explicit exceptions; never bare `except:`. Context managers for resources.
- No mutable default arguments. No wildcard imports.
- Tests: pytest, plain `assert`.

## Go
- Go ≥ 1.24 (1.22 minimum, for range-over-int and loop-var semantics). Errors are returned and wrapped with `fmt.Errorf("...: %w", err)`; never ignored with `_` unless justified in a comment.
- `context.Context` as first parameter for anything that does I/O.
- Generics where they remove duplication; interfaces small and defined at the consumer.
- `slices`, `maps`, `log/slog` from the standard library. No `ioutil`.
- Table-driven tests with `t.Run`.

## Rust
- Edition 2024 (2021 minimum). `Result<T, E>` with `?`; no `unwrap()`/`expect()` outside tests and `main`.
- `thiserror` for library errors, `anyhow` only at binary boundaries (if the repo allows the dependency).
- Borrow, don't clone, unless clarity demands it and a comment says so. No `unsafe` unless the packet allows it.
- Clippy-clean at default level.

## Java / Kotlin
- Java ≥ 21 (records, sealed types, pattern matching for switch, virtual threads; 17 minimum). Kotlin ≥ 2.1 (K2 compiler, data classes, sealed interfaces, coroutines for async).
- Immutability by default: `final` fields / `val`. `Optional` / nullable types instead of null checks scattered everywhere.
- No raw types. No checked-exception swallowing.
- JUnit 5 / Kotest.

## Swift
- Swift ≥ 6 with strict concurrency where the package enables it (5.9 minimum). `struct` by default, `class` only when reference semantics are needed. Value types `Sendable` where shared.
- `async`/`await` and structured concurrency; no completion-handler APIs in new code.
- `guard` for early exits; no force-unwraps (`!`) outside tests.
- Swift Testing or XCTest per the repo.

## C#
- .NET ≥ 9 (8 LTS minimum), nullable reference types enabled, file-scoped namespaces, records for DTOs.
- `async`/`await` end to end with `CancellationToken` parameters. No `.Result` / `.Wait()`.
- Pattern matching and switch expressions. `IReadOnlyList<T>` on public surfaces.
- xUnit.

## Shell (when unavoidable)
- Bash: `set -euo pipefail`, quote every variable, `[[ ]]` tests, no parsing `ls`.
- PowerShell: `Set-StrictMode -Version Latest`, `$ErrorActionPreference = 'Stop'`.

## Universal
- Match the repo's existing formatter/linter config; do not introduce a new style.
- Every public function has a one-line doc comment stating what it does and what it returns.
- No commented-out code, no `TODO` in delivered code, no debug prints.
