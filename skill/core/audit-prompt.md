# Auditor prompt

The auditor is a **strong model in a fresh context**: never the local executor, never the planner's own context. How you get a fresh context depends on your agent:

- **Claude Code**: Task tool, `model: opus`, `subagent_type: general-purpose`, this prompt as the task.
- **Codex CLI**: `codex exec --model <strongest available> "<this prompt>"` from the repo root (a second invocation, not the current one).
- **Cursor / Windsurf**: open a new chat/composer and paste this prompt. Bring the verdict back to the planning chat.

The auditor should have read access to the repo so it can look at neighboring code, but it must not edit anything. Fill in the three placeholders and send as the task.

```
You are auditing a code change written by a small local language model. The change already passes its tests. Your job is to catch what tests don't: correctness gaps, security issues, and code that will hurt later.

## The task packet the executor received
{PACKET}

## The diff it produced
{DIFF}

## Test output
{TEST_OUTPUT}

Review the diff against the packet. Check, in this order:
1. Correctness — does it actually satisfy the Goal, or just the tests? Look for edge cases the tests don't cover (empty input, None/null, unicode, concurrency, off-by-one).
2. Scope — did it touch anything outside "Files you may change"? Did it violate any "Do NOT"?
3. Safety — injection, unsafe deserialization, path traversal, secrets in code, unbounded resource use.
4. Fit — does it match the stated conventions, including the modern-practices block, and the surrounding codebase? Any deprecated API, untyped escape hatch, or swallowed error is at least a major.
5. Tests — are the packet's tests themselves adequate? If a critical case is missing, say which one. Watch for code that satisfies one test by making another impossible (a guard that short-circuits a path the second test needs).

Respond with exactly this format:

VERDICT: ACCEPT | REJECT

ISSUES:
1. [severity: blocker|major|minor] <file:line if applicable> — <one or two sentences, concrete, actionable>
2. ...

(If ACCEPT with no issues, write "ISSUES: none".)

MISSING TESTS:
- <test case description, or "none">

Reject for any blocker. Accept with listed minors is fine. Do not rewrite the code yourself; describe the fix precisely enough that a small model can apply it.
```

## How the planner uses the verdict

- `ACCEPT` → apply and move on. Add any "MISSING TESTS" to the repo if they're cheap.
- `REJECT` → build a retry packet: copy the original, append the ISSUES list under `## Previous attempt failed`, and re-run the executor. Counts toward the 3-attempt cap.
- If the auditor flags a **planning** problem (bad packet, inadequate tests), fix the packet yourself rather than retrying blindly.
- Never skip the audit because "the tests pass". Passing tests is the entry ticket to the audit, not a substitute for it.
