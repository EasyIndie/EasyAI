#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${BASE_URL:-http://localhost:3003}"
API_KEY="${API_KEY:-dev-key}"
ADMIN_USER="${ADMIN_USER:-admin}"
ADMIN_PASS="${ADMIN_PASS:-admin}"

json() {
  command jq -e . >/dev/null 2>&1
}

echo "[1/6] healthz"
curl -fsS "$BASE_URL/healthz" | json

echo "[2/6] docs"
curl -fsS "$BASE_URL/openapi.json" | json

echo "[3/6] authenticated models"
curl -fsS "$BASE_URL/v1/models" -H "Authorization: Bearer $API_KEY" | json

echo "[4/6] authenticated chat"
curl -fsS "$BASE_URL/v1/chat/completions" \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model":"chat","messages":[{"role":"user","content":"smoke"}],"temperature":0}' | json

echo "[5/6] dashboard auth"
curl -fsS -u "$ADMIN_USER:$ADMIN_PASS" "$BASE_URL/admin/api/usage?sinceMinutes=60" | json

echo "[6/6] batch queue and status"
BATCH_ID="$(curl -fsS -X POST "$BASE_URL/v1/batches" \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"requests":[{"endpoint":"/v1/chat/completions","body":{"model":"chat","messages":[{"role":"user","content":"batch-smoke"}],"temperature":0}}]}' | jq -r '.id')"

if [[ -z "$BATCH_ID" || "$BATCH_ID" == "null" ]]; then
  echo "batch id missing"
  exit 1
fi

for _ in {1..15}; do
  STATUS="$(curl -fsS "$BASE_URL/v1/batches/$BATCH_ID" -H "Authorization: Bearer $API_KEY" | jq -r '.status')"
  if [[ "$STATUS" == "completed" || "$STATUS" == "failed" ]]; then
    break
  fi
  sleep 1
done

curl -fsS "$BASE_URL/v1/batches/$BATCH_ID/output" -H "Authorization: Bearer $API_KEY" >/dev/null
echo "OK"
