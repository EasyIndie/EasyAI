#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
export NODE_OPTIONS="${NODE_OPTIONS---no-deprecation}"
export NPM_CONFIG_FUND="${NPM_CONFIG_FUND-false}"
export NPM_CONFIG_AUDIT="${NPM_CONFIG_AUDIT-false}"

echo "[1/4] oneapi-gateway: tests + doc-audit"
cd "$root/oneapi-gateway"
npm ci --no-fund --no-audit
npm test
npm run doc-audit

echo "[2/4] admin-ui: build"
cd "$root/oneapi-gateway/admin-ui"
npm ci --no-fund --no-audit
npm run build

echo "[3/4] litellm-service: unit tests"
cd "$root"
python3 -m unittest discover -s litellm-service/test -p 'test_*.py'

echo "[4/4] kustomize: render validate"
kubectl kustomize "$root/k8s/combined" >/dev/null
kubectl kustomize "$root/k8s/litellm" >/dev/null

echo "OK"
