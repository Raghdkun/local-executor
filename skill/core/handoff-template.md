# Task packet format

The executor sees nothing but this document. Every packet uses this exact structure. Sections marked (required) must never be empty.

```markdown
# Task: <one-line title>

## Goal (required)
<2–4 sentences. What the code must do when finished. State the observable behavior, not the implementation.>

## Files you may change (required)
- path/to/file.py — <what changes here>

You may NOT change any other file.

## Conventions (required)
- Language/version: <e.g. Python 3.12>
- Style: <e.g. type hints on all functions, no print(), use logging>
- Allowed dependencies: <e.g. stdlib only>
- Naming: <anything the repo cares about>
- Modern practices (required — copy the block for this language from modern-practices.md):
  - <bullet 1>
  - <bullet 2>
  - ...

## Existing code (required if the file exists)
### path/to/file.py
```python
<full current contents, verbatim>
```

## Tests that must pass (required)
Command: `<exact command, e.g. pytest tests/test_utils.py -q>`

### tests/test_utils.py
```python
<the tests that exercise this change, verbatim — the whole file when it fits>
```
Other tests in this file exist and are unchanged.

## Do NOT
- <refactor unrelated code>
- <add new dependencies>
- <change function signatures listed above>

## Previous attempt failed (only on retry)
Attempt <n> failed. Fix exactly these, nothing else:
1. <file:line or symbol> — <what is wrong> → <the exact change, e.g. "assign `(byId(x) ?? fallback).build()`, not `byId(x)`">
2. <…> → <…>

Test output, trimmed:
```
<the failing assertion or compiler error only>
```
```

## Why each section exists

- **Goal** first, because small models anchor on whatever comes first.
- **Files you may change** bounds the blast radius. Without it, executors "helpfully" rewrite neighbors.
- **Existing code verbatim and complete** for every file it may change: the executor cannot read the disk and it returns whole files, so anything you leave out is deleted. If you summarize instead of pasting, it will hallucinate the parts you skipped. When a file does not fit the budget, split the change into a new file or do that file yourself; never excerpt a file the executor will rewrite.
- **Tests verbatim, but excerpting is fine**: this is the contract. The executor optimizes for making the tests pass, which is exactly what you want when you wrote the tests. It never edits tests, so paste the ones that matter for this change and say the rest exist unchanged. That keeps a 350-line test file from eating the budget.
- **Conventions → Modern practices** is mandatory. Small models default to whatever was most common in their training data, which is often years out of date. The block pins the language version, the idioms, and the escape hatches that are off limits.
- **Do NOT** is more effective than positive instructions for small models. Be concrete.
- **Previous attempt failed** turns a retry into a targeted fix rather than a fresh guess. The numbered "fix exactly these" list is what small models actually follow; raw test output alone often produces the same file again (the runner detects that and exits 6). Name the symbol, say what is wrong, and give the exact replacement.

## Sizing

Budget: the system prompt plus the packet plus a **complete copy of every file the executor may change** (its reply) must fit in `num_ctx` (16k by default, 32k when installed on a machine with headroom). In practice that means about 6,000 tokens of pasted code for a 16k context. `run_executor.mjs --dry-run` prints the estimate; the runner refuses to send a packet that cannot fit and warns above 85%.

If it does not fit, split by file (one packet per file, in dependency order), or move the new code into a new file the executor can own outright, so the existing large file only needs a one-line import change you make yourself. Do not excerpt a file the executor must return in full.
