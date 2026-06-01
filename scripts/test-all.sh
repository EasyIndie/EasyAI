#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
export NODE_OPTIONS="${NODE_OPTIONS---no-deprecation}"
export NPM_CONFIG_FUND="${NPM_CONFIG_FUND-false}"
export NPM_CONFIG_AUDIT="${NPM_CONFIG_AUDIT-false}"

echo "[1/6] oneapi-gateway: tests + doc-audit"
cd "$root/oneapi-gateway"
npm ci --no-fund --no-audit
npm run build
npm test
npm run doc-audit

echo "[2/6] admin-ui: build"
cd "$root/oneapi-gateway/admin-ui"
npm ci --no-fund --no-audit
npm run build

echo "[3/6] chat-ui: build"
cd "$root/oneapi-gateway/chat-ui"
npm ci --no-fund --no-audit
npm run build

echo "[4/6] batch-worker: build"
cd "$root/batch-worker"
npm ci --no-fund --no-audit
npm run build

echo "[5/6] litellm-service: unit tests"
cd "$root"
python3 -m unittest discover -s litellm-service/test -p 'test_*.py'

echo "[6/6] compose smoke: hard gate"
cleanup() {
  docker compose -f "$root/docker-compose.yml" down -v >/dev/null 2>&1 || true
}
trap cleanup EXIT

docker compose -f "$root/docker-compose.yml" up -d --build redis postgres ollama litellm oneapi batch_worker
# Ensure local Ollama model exists before smoke checks the chat endpoint.
docker compose -f "$root/docker-compose.yml" exec -T ollama ollama pull qwen2.5:0.5b
"$root/scripts/smoke-compose.sh"

echo "OK"
