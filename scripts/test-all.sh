#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
export NODE_OPTIONS="${NODE_OPTIONS---no-deprecation}"
export NPM_CONFIG_FUND="${NPM_CONFIG_FUND-false}"
export NPM_CONFIG_AUDIT="${NPM_CONFIG_AUDIT-false}"

echo "[1/5] oneapi-gateway: tests + doc-audit"
cd "$root/oneapi-gateway"
npm ci --no-fund --no-audit
npm run build
npm test
npm run doc-audit

echo "[2/5] admin-ui: build"
cd "$root/oneapi-gateway/admin-ui"
npm ci --no-fund --no-audit
npm run build

echo "[3/5] batch-worker: build"
cd "$root/batch-worker"
npm ci --no-fund --no-audit
npm run build

echo "[4/5] litellm-service: unit tests"
cd "$root"
python3 -m unittest discover -s litellm-service/test -p 'test_*.py'

echo "[5/5] compose smoke: hard gate"
cleanup() {
  docker compose -f "$root/docker-compose.yml" down -v >/dev/null 2>&1 || true
}
trap cleanup EXIT

docker compose -f "$root/docker-compose.yml" up -d --build redis postgres ollama litellm oneapi batch_worker
"$root/scripts/smoke-compose.sh"

echo "OK"
