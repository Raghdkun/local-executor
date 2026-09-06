#!/usr/bin/env python3
"""Send a task packet to the local Ollama model and collect the code it returns.

Usage:
  run_executor.py --packet packet.md --out response.md [--apply] [--model NAME]

The executor is told to answer ONLY with fenced code blocks whose info string is
the target file path, e.g.:

    ```python path=src/utils.py
    ...
    ```

With --apply, each block is written to that path (a .bak copy is made first).
Without --apply, the blocks are only saved to --out for the planner to inspect.
"""
import argparse
import json
import re
import shutil
import sys
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
CONFIG = json.loads((HERE / "config.json").read_text())

SYSTEM_PROMPT = (HERE.parent / "references" / "executor-system-prompt.md").read_text()

BLOCK_RE = re.compile(r"```(\w+)?\s+path=(\S+)\n(.*?)```", re.DOTALL)


def call_ollama(model: str, packet: str) -> str:
    body = {
        "model": model,
        "stream": False,
        "options": {
            "temperature": CONFIG.get("temperature", 0.1),
            "num_ctx": CONFIG.get("num_ctx", 16384),
        },
        "keep_alive": CONFIG.get("keep_alive", "30m"),
        "messages": [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": packet},
        ],
    }
    req = urllib.request.Request(
        f"{CONFIG['ollama_url']}/api/chat",
        data=json.dumps(body).encode(),
        headers={"Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=CONFIG.get("timeout_seconds", 600)) as r:
        return json.loads(r.read())["message"]["content"]


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--packet", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--apply", action="store_true")
    ap.add_argument("--model", default=CONFIG["model"])
    ap.add_argument("--root", default=".", help="repo root for --apply")
    args = ap.parse_args()

    packet = Path(args.packet).read_text()
    try:
        response = call_ollama(args.model, packet)
    except Exception as e:  # noqa: BLE001
        print(f"EXECUTOR ERROR: {e}", file=sys.stderr)
        return 2

    Path(args.out).write_text(response)
    blocks = BLOCK_RE.findall(response)
    if not blocks:
        print("EXECUTOR RETURNED NO CODE BLOCKS — see", args.out, file=sys.stderr)
        return 3

    print(f"Executor returned {len(blocks)} file(s):")
    for _lang, path, _code in blocks:
        print("  -", path)

    if args.apply:
        root = Path(args.root)
        for _lang, path, code in blocks:
            target = root / path
            target.parent.mkdir(parents=True, exist_ok=True)
            if target.exists():
                shutil.copy2(target, target.with_suffix(target.suffix + ".bak"))
            target.write_text(code)
            print("  wrote", target)
    return 0


if __name__ == "__main__":
    sys.exit(main())
