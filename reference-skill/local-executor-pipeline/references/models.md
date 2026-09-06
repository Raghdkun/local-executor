# Choosing the executor model

The rule: the model file plus its context cache must fit in memory alongside the OS, the agent, and an editor. On Apple Silicon roughly 70% of unified RAM is usable for the model; on a PC with an NVIDIA GPU, count VRAM; on CPU-only x64, count about half of RAM. A model that doesn't fit swaps to disk and drops to 1–2 tokens/sec — worse than useless.

Mixture-of-Experts models (e.g. Gemma 4 26B, "4B active") are fast to compute but still need the **whole** model in memory. Active-parameter count is not memory footprint.

| Usable memory | Recommended | Alternatives | Notes |
|---|---|---|---|
| < 6 GB | `qwen3.5:2b` | `gemma4:e2b` | Very tight; short packets only |
| 6–10 GB | `qwen3.5:4b` | `gemma4:e4b` | Light and fast; small tasks |
| 10–14 GB (16 GB Mac) | `qwen3.5:9b` (~6.6 GB) | `gemma4:e4b`, `qwen3.5:4b` | Best code quality that fits |
| 14–22 GB | `qwen3.5:9b` | `qwen3.5:9b-mlx` (Apple, 8.9 GB, faster) | Headroom for larger context |
| 22–30 GB | `gemma4:26b` (~17 GB) | `qwen3.5:9b` | MoE 26B fits; strong coding |
| 30–48 GB | `qwen3.6:35b-a3b` | `gemma4:26b`, `gemma4:31b` | Frontier-adjacent local coding |
| ≥ 48 GB | `qwen3.6:35b-a3b` | `gemma4:31b` | Room for big context |

Verify tag names on ollama.com before pulling — tags change between releases. Last verified: September 2026 for `qwen3.5:9b`, `qwen3.5:9b-mlx`, `qwen3.5:4b`, `gemma4:e4b`, `gemma4:26b`.

## Cold start

The first call after the model unloads takes 10–30 s while it loads. The scripts pass `keep_alive` (default 30m, in `config.json`) so the model stays resident between packets. Set `OLLAMA_KEEP_ALIVE=-1` in the environment to keep it loaded permanently while working.

## Context window

`num_ctx` in `config.json` is 16384. Larger contexts cost memory (the KV cache grows linearly). If the model starts swapping, drop `num_ctx` to 8192 before stepping down a model size — most packets fit in 8k.

## Changing the model

Edit `scripts/config.json`, then `ollama pull <tag>`. Nothing else needs to change.
