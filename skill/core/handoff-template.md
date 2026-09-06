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
<full contents of the test file the planner wrote, verbatim>
```

## Do NOT
- <refactor unrelated code>
- <add new dependencies>
- <change function signatures listed above>

## Previous attempt failed (only on retry)
Attempt <n> produced this test output:
```
<pasted failure output, trimmed to the relevant part>
```
Fix this specific failure.
```

## Why each section exists

- **Goal** first, because small models anchor on whatever comes first.
- **Files you may change** bounds the blast radius. Without it, executors "helpfully" rewrite neighbors.
- **Existing code verbatim**: the executor cannot read the disk. If you summarize instead of pasting, it will hallucinate the parts you skipped.
- **Tests verbatim**: this is the contract. The executor optimizes for making the tests pass, which is exactly what you want when you wrote the tests.
- **Conventions → Modern practices** is mandatory. Small models default to whatever was most common in their training data, which is often years out of date. The block pins the language version, the idioms, and the escape hatches that are off limits.
- **Do NOT** is more effective than positive instructions for small models. Be concrete.
- **Previous attempt failed** turns a retry into a targeted fix rather than a fresh guess.

## Sizing

If the packet exceeds ~6,000 tokens of pasted code, it is too big for one executor call. Split it: either by file, or by extracting the specific function and its immediate dependencies.
