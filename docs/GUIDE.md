# A plain-language guide to running a local coding model

This is for someone who has never run a language model on their own machine. It explains what `local-executor` sets up, what the words mean, and how to tell whether it is working well. Nothing here requires a GPU degree.

## What Ollama is

Ollama is a program that runs open-weight language models on your computer. It does two jobs:

1. It downloads model files from ollama.com and stores them in `~/.ollama/models` (or wherever `OLLAMA_MODELS` points).
2. It runs a small web server on your machine at `http://localhost:11434`. Anything that wants to talk to a model sends HTTP requests to that address. Nothing leaves your computer.

`lex` installs Ollama if you don't have it (showing you the exact command first), starts the server if it isn't running, and checks whether a newer version exists. If you already use Ollama, pick "Skip" at the first prompt and `lex` leaves it alone.

## What "open-weight" and "quantization" mean

An open-weight model is one whose trained parameters ("weights") are published, so you can download and run them. Qwen (Alibaba), Gemma (Google), and Devstral (Mistral) are the families in our catalog.

Weights are numbers. In training they are stored with 16 bits each; a 9-billion-parameter model is therefore about 18 GB. *Quantization* rounds those numbers to fewer bits, most often 4, so the same model becomes about 5–7 GB and runs faster, with a small loss in quality. Every model in the catalog is a 4-bit-ish build unless the tag says otherwise (`-q8_0` is 8-bit, `-bf16` is unquantized). For a code executor that is checked by tests and audited by a stronger model, 4-bit is the right trade.

## Why memory decides everything

The whole model has to sit in fast memory while it runs. If it doesn't fit, the operating system pages parts of it to disk and speed falls from 30 tokens/sec to 1 or 2. That is not "a bit slower"; it is unusable.

"Fast memory" means:

- **Apple Silicon Macs**: the unified memory shared by CPU and GPU. Around 70% of it is realistically available for a model once macOS, your editor, and your AI agent have their share. A 16 GB Mac has ~11 GB for models.
- **PCs with an NVIDIA or AMD graphics card**: the card's VRAM. System RAM does not count, because a model split across VRAM and RAM runs at the speed of the slow part.
- **Everything else (CPU only)**: about half of system RAM.

`lex models` prints the number it computed for your machine and which rule it used.

One trap worth knowing: **mixture-of-experts (MoE) models**. Gemma 4 26B advertises "4B active parameters", meaning only 4B are used per token, which makes it fast. But all 26B must be in memory. Active parameters describe speed, not footprint. That is why a 26B MoE is recommended at 22 GB and up, not on a 16 GB laptop.

## Reading tokens per second

After pulling a model, `lex` sends it one short prompt and prints tokens/sec. A token is roughly three-quarters of an English word, or a few characters of code.

| Tokens/sec | What it means for the pipeline |
|---|---|
| under 5 | The model does not fit, or the CPU is doing all the work. Step down a size or shrink `num_ctx`. |
| 5–15 | Usable for short packets. A 200-line file takes a minute or two. |
| 15–40 | Comfortable. Typical for a 9B model on an M-series Mac or a mid-range GPU. |
| 40+ | Fast. Room to try a larger model if quality is the limit. |

The first request after Ollama loads a model is slow (10–30 s) because the file is being read into memory. `lex` sets `keep_alive` to 30 minutes so the model stays loaded between packets. If you see the slow first request on every call, something is unloading the model: another tool using Ollama, or memory pressure.

## What "context size" (`num_ctx`) is

The context is how much text the model can hold at once: the system prompt, your packet, and its reply. `lex` sets it to 16,384 tokens, enough for a packet with a few hundred lines of code plus tests. Context costs memory (the "KV cache" grows with it), so if a model that should fit is swapping, halve `num_ctx` to 8192 in `config.json` before choosing a smaller model.

## How to know the setup is healthy

Run `lex doctor`. Every line should say `ok`. Common results:

- **ollama server: not reachable** — Ollama isn't running. Open the Ollama app (macOS/Windows) or run `ollama serve` in a terminal.
- **model: not pulled** — the configured tag isn't downloaded. `ollama pull <tag>`, or `lex switch <tag>`.
- **files: missing …** — something deleted part of the installed skill. Re-run `lex init`.

You can also watch memory while a packet runs: Activity Monitor → Memory → "Memory Pressure" graph on macOS (green is fine, yellow means you're at the edge, red means swapping); Task Manager → Performance → GPU → "Dedicated GPU memory" on Windows.

## When to upgrade the model

Upgrade when the executor's output is the bottleneck, not before. Signs:

- The auditor keeps rejecting for the same class of mistake (dropped error handling, wrong types) on packets that are well written.
- The planner regularly escalates because the executor returns prose or partial files.
- Tokens/sec is comfortably above 30 and memory pressure stays green.

If two of those are true, run `lex models`, pick the next tier up, and `lex switch <tag>`. If memory is the limit, the honest answer is more RAM or a bigger GPU; a model that doesn't fit is worse than a smaller one that does.

## When to downgrade

- Tokens/sec under 10 on a model the table said should fit: something else is using memory, or the catalog's estimate was optimistic for your machine. Try `num_ctx: 8192` first, then the next tier down.
- You mostly hand off small, mechanical tasks. A 4B model that answers in ten seconds beats a 9B model that answers in a minute when the work is boilerplate.

## What the three roles actually do

- **Planner** (Claude Code, Codex, Cursor, or Windsurf): reads your request, looks at the repo, writes the tests, writes a self-contained "task packet" for the executor. It uses every skill and MCP tool it has to get facts into the packet.
- **Executor** (the local model): receives only the packet, returns only code. It has no tools, cannot read files, and is told exactly what not to do.
- **Auditor** (a strong cloud model in a fresh context): reads the packet, the diff, and the test output, and answers ACCEPT or REJECT with a numbered list of issues.

The packet is the whole trick. A small model given a narrow, fully specified task with tests it must pass behaves very differently from the same model asked an open question. See [`skill/core/PIPELINE.md`](../skill/core/PIPELINE.md) for the rules the planner follows.

## Cost expectations

The local model costs electricity. The planner and auditor calls go to whichever cloud agent you already pay for; the pipeline reduces those calls to planning, test writing, and review, which are much shorter than generating and iterating on full files. The savings are largest on medium-sized tasks. For one-line fixes the pipeline is overhead and the skill tells the planner to skip it.
