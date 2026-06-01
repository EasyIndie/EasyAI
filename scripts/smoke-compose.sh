#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${BASE_URL:-http://localhost:3004}"
CONFIG_FILE="${CONFIG_FILE:-config/easyai.development.yaml}"

read_yaml_value() {
  local key="$1"
  awk -v key="$key" '
    function clean(v) {
      sub(/^[[:space:]]+/, "", v)
      sub(/[[:space:]]+$/, "", v)
      sub(/^"/, "", v)
      sub(/"$/, "", v)
      return v
    }
    # Parse `secrets.api_keys[0]` without relying on fixed indentation.
    key == "api_key" && $0 ~ /^[[:space:]]*api_keys:[[:space:]]*$/ { in_api_keys=1; next }
    in_api_keys && $0 ~ /^[[:space:]]*-[[:space:]]*/ {
      sub(/^[[:space:]]*-[[:space:]]*/, "")
      print clean($0)
      exit
    }
    in_api_keys && $0 !~ /^[[:space:]]*-[[:space:]]*/ && $0 !~ /^[[:space:]]*$/ { in_api_keys=0 }

    key == "admin_pass" && $0 ~ /^[[:space:]]*admin_password:[[:space:]]*/ {
      sub(/^[[:space:]]*admin_password:[[:space:]]*/, "")
      print clean($0)
      exit
    }
  ' "$CONFIG_FILE"
}

API_KEY="${API_KEY:-$(read_yaml_value api_key)}"
ADMIN_USER="${ADMIN_USER:-admin}"
ADMIN_PASS="${ADMIN_PASS:-$(read_yaml_value admin_pass)}"

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
  -d '{"requests":[{"endpoint":"/v1/chat/completions","body":{"model":"chat","messages":[{"role":"user","content":"batch-smoke"}],"temperature":0}}]}' | jq -r '.batch_id // .id')"

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
