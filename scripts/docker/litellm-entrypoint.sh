#!/bin/sh
# Entrypoint for the official LiteLLM Proxy image used as EasyAI's model access plane.
# Renders the LiteLLM config from the single EasyAI YAML, then starts LiteLLM.
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
RENDERER="${EASYAI_RENDERER:-$SCRIPT_DIR/../render-litellm-config.py}"
EASYAI_CONFIG="${EASYAI_CONFIG:-/app/config/easyai.yaml}"
LITELLM_CONFIG="${LITELLM_CONFIG:-/tmp/litellm-config.yaml}"

if [ ! -f "$EASYAI_CONFIG" ]; then
  echo "easyai config not found: $EASYAI_CONFIG" >&2
  exit 1
fi
if [ ! -f "$RENDERER" ]; then
  echo "config renderer not found: $RENDERER" >&2
  exit 1
fi

LITELLM_MASTER_KEY="$(python3 "$RENDERER" --print-master-key "$EASYAI_CONFIG")"
if [ -z "$LITELLM_MASTER_KEY" ]; then
  echo "secrets.master_key is required in $EASYAI_CONFIG" >&2
  exit 1
fi
export LITELLM_MASTER_KEY

# Admin UI + virtual keys + spend logs need a database.
export DATABASE_URL="${DATABASE_URL:-$(python3 "$RENDERER" --print-database-url "$EASYAI_CONFIG")}"
# Encrypts provider keys stored via the UI. Keep it stable across restarts.
export LITELLM_SALT_KEY="${LITELLM_SALT_KEY:-$(python3 "$RENDERER" --print-salt-key "$EASYAI_CONFIG")}"
# First-run console login (the master key is also accepted as the password).
export UI_USERNAME="${UI_USERNAME:-admin}"

python3 "$RENDERER" "$EASYAI_CONFIG" > "$LITELLM_CONFIG"

exec litellm --config "$LITELLM_CONFIG" --port "${LITELLM_PORT:-4000}"
