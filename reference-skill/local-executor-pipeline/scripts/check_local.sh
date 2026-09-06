#!/usr/bin/env bash
# Reports whether Ollama is installed, running, and has the configured model.
# Exit 0 = ready. Exit 1 = something missing (message says what).
set -u
DIR="$(cd "$(dirname "$0")" && pwd)"
MODEL=$(python3 -c "import json;print(json.load(open('$DIR/config.json'))['model'])")
URL=$(python3 -c "import json;print(json.load(open('$DIR/config.json'))['ollama_url'])")

if ! command -v ollama >/dev/null 2>&1; then
  echo "MISSING: ollama not installed. Run scripts/setup_local.sh"
  exit 1
fi

if ! curl -s --max-time 3 "$URL/api/tags" >/dev/null; then
  echo "NOT RUNNING: ollama server not reachable at $URL. Try: ollama serve &"
  exit 1
fi

if ! curl -s "$URL/api/tags" | grep -q "\"name\":\"$MODEL\""; then
  echo "MISSING MODEL: $MODEL not pulled. Run: ollama pull $MODEL"
  exit 1
fi

echo "READY: ollama running at $URL with model $MODEL"
