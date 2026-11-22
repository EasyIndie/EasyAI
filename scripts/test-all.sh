#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
export NODE_OPTIONS="${NODE_OPTIONS---no-deprecation}"
export NPM_CONFIG_FUND="${NPM_CONFIG_FUND-false}"
export NPM_CONFIG_AUDIT="${NPM_CONFIG_AUDIT-false}"

if ! python3 -c "import yaml" >/dev/null 2>&1; then
  echo "missing PyYAML: python3 -m pip install -r scripts/requirements.txt" >&2
  exit 1
fi

echo "[1/4] oneapi-gateway: tests + doc-audit"
cd "$root/oneapi-gateway"
npm ci --no-fund --no-audit
npm run build
npm test
npm run doc-audit

echo "[2/4] batch-worker: build"
cd "$root/batch-worker"
npm ci --no-fund --no-audit
npm run build

echo "[3/4] litellm config render"
cd "$root"
python3 scripts/render-litellm-config.py config/easyai.development.yaml >/dev/null
python3 scripts/render-litellm-config.py --print-master-key config/easyai.development.yaml >/dev/null
python3 scripts/render-litellm-config.py --print-database-url config/easyai.development.yaml >/dev/null
python3 scripts/render-litellm-config.py --print-salt-key config/easyai.development.yaml >/dev/null

echo "[4/4] compose smoke: hard gate"
cleanup() {
  docker compose -f "$root/docker-compose.yml" down -v >/dev/null 2>&1 || true
}
trap cleanup EXIT

docker compose -f "$root/docker-compose.yml" up -d --build redis postgres ollama litellm oneapi batch_worker
# Ensure local Ollama model exists before smoke checks the chat endpoint.
docker compose -f "$root/docker-compose.yml" exec -T ollama ollama pull qwen2.5:0.5b
"$root/scripts/smoke-compose.sh"

echo "OK"
