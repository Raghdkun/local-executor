#!/usr/bin/env bash
# One-time setup for macOS (Apple Silicon). Installs Ollama and pulls the executor model.
# Downloads are several GB, so run this with the user's go-ahead.
set -eu
DIR="$(cd "$(dirname "$0")" && pwd)"
MODEL=$(python3 -c "import json;print(json.load(open('$DIR/config.json'))['model'])")

if ! command -v ollama >/dev/null 2>&1; then
  if command -v brew >/dev/null 2>&1; then
    echo "Installing Ollama via Homebrew..."
    brew install ollama
  else
    echo "Homebrew not found. Install Ollama from https://ollama.com/download then re-run."
    exit 1
  fi
fi

# Start the server if it isn't already up.
if ! curl -s --max-time 3 http://localhost:11434/api/tags >/dev/null; then
  echo "Starting ollama server in the background..."
  nohup ollama serve >/tmp/ollama.log 2>&1 &
  sleep 3
fi

echo "Pulling $MODEL (this may take a while)..."
ollama pull "$MODEL"

# Keep the model loaded between calls so the first token isn't slow every time.
# 30m is a reasonable default; set to -1 to keep it loaded indefinitely.
echo "Warming up..."
curl -s http://localhost:11434/api/generate \
  -d "{\"model\":\"$MODEL\",\"prompt\":\"hi\",\"keep_alive\":\"30m\",\"stream\":false}" >/dev/null

"$DIR/check_local.sh"
