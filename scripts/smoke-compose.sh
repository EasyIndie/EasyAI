#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${BASE_URL:-http://localhost:3004}"
CONFIG_FILE="${CONFIG_FILE:-config/easyai.development.yaml}"

retry_curl_json() {
  local url="$1"
  local attempts="${2:-30}"
  local sleep_sec="${3:-1}"
  local i
  for ((i=1; i<=attempts; i++)); do
    if curl -fsS "$url" | json; then
      return 0
    fi
    sleep "$sleep_sec"
  done
  return 1
}

retry_cmd() {
  local attempts="${1:-30}"
  local sleep_sec="${2:-1}"
  shift 2
  local i
  for ((i=1; i<=attempts; i++)); do
    if "$@"; then
      return 0
    fi
    sleep "$sleep_sec"
  done
  return 1
}

check_models() {
  curl -fsS "$BASE_URL/v1/models" -H "Authorization: Bearer $API_KEY" | jq -e . >/dev/null
}

check_chat() {
  curl -fsS "$BASE_URL/v1/chat/completions" \
    -H "Authorization: Bearer $API_KEY" \
    -H "Content-Type: application/json" \
    -d '{"model":"chat","messages":[{"role":"user","content":"smoke"}],"temperature":0}' | jq -e . >/dev/null
}

check_dashboard() {
  curl -fsS -u "$ADMIN_USER:$ADMIN_PASS" "$BASE_URL/admin/api/usage?sinceMinutes=60" | jq -e . >/dev/null
}

create_batch() {
  curl -fsS -X POST "$BASE_URL/v1/batches" \
    -H "Authorization: Bearer $API_KEY" \
    -H "Content-Type: application/json" \
    -d '{"requests":[{"endpoint":"/v1/chat/completions","body":{"model":"chat","messages":[{"role":"user","content":"batch-smoke"}],"temperature":0}}]}' \
    | jq -r '.batch_id // .id'
}

check_batch_output() {
  curl -fsS "$BASE_URL/v1/batches/$BATCH_ID/output" -H "Authorization: Bearer $API_KEY" >/dev/null
}

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
retry_curl_json "$BASE_URL/healthz" 45 1

echo "[2/6] docs"
retry_curl_json "$BASE_URL/openapi.json" 30 1

echo "[3/6] authenticated models"
retry_cmd 30 1 check_models

echo "[4/6] authenticated chat"
retry_cmd 40 1 check_chat

echo "[5/6] dashboard auth"
retry_cmd 30 1 check_dashboard

echo "[6/6] batch queue and status"
BATCH_ID="$(retry_cmd 30 1 create_batch)"

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

retry_cmd 30 1 check_batch_output
echo "OK"
