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
compose() {
  docker compose -f "$root/docker-compose.yml" "$@"
}
cleanup() {
  status=$?
  if [ "$status" -ne 0 ]; then
    echo "--- compose ps ---"
    compose ps || true
    echo "--- litellm / oneapi logs (tail) ---"
    compose logs --tail=120 litellm oneapi batch_worker || true
  fi
  compose down -v >/dev/null 2>&1 || true
}
trap cleanup EXIT

compose up -d --build redis postgres ollama litellm oneapi batch_worker

echo "waiting for LitellM to become ready ..."
ready=""
for _ in $(seq 1 90); do
  if curl -fsS http://127.0.0.1:3005/health/liveliness >/dev/null 2>&1; then
    ready="1"
    break
  fi
  sleep 2
done
if [ -z "$ready" ]; then
  echo "LitellM did not become ready within 180s" >&2
  exit 1
fi

# Ensure local Ollama model exists before smoke checks the chat endpoint.
compose exec -T ollama ollama pull qwen2.5:0.5b
"$root/scripts/smoke-compose.sh"

echo "OK"
