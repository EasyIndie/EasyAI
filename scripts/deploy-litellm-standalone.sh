#!/bin/bash

# Exit on error
set -e

# Default values
PORT=4000
LITELLM_IMAGE="easyai/litellm-service:latest"
CONFIG_PATH="$(pwd)/config/litellm/litellm.yaml"
# For Docker on Linux/Mac/Windows to access host's 127.0.0.1
# Note: In Linux, if using host.docker.internal fails, Docker 20.10+ supports adding --add-host=host.docker.internal:host-gateway
DEFAULT_OLLAMA_HOST="http://host.docker.internal:11434"

echo "====================================="
echo "  Deploying Standalone LiteLLM Service"
echo "====================================="

# 1. Build the Docker image
echo "=> Building Docker image ($LITELLM_IMAGE)..."
docker build -t "$LITELLM_IMAGE" ./litellm-service

# 2. Check if a container named 'litellm-standalone' is already running, if so, stop it
if [ "$(docker ps -aq -f name=litellm-standalone)" ]; then
    echo "=> Stopping existing 'litellm-standalone' container..."
    docker stop litellm-standalone >/dev/null
    docker rm litellm-standalone >/dev/null
fi

# 3. Determine OLLAMA_HOST (allow override via environment variable)
if [ -z "$OLLAMA_HOST" ]; then
    OLLAMA_HOST=$DEFAULT_OLLAMA_HOST
    echo "=> No OLLAMA_HOST provided, defaulting to: $OLLAMA_HOST"
else
    echo "=> Using provided OLLAMA_HOST: $OLLAMA_HOST"
fi

# 4. Run the container
echo "=> Starting LiteLLM container on port $PORT..."
docker run -d \
    --name litellm-standalone \
    -p "$PORT:$PORT" \
    --add-host=host.docker.internal:host-gateway \
    -v "$CONFIG_PATH:/app/config/litellm.yaml" \
    -e LITELLM_CONFIG_PATH=/app/config/litellm.yaml \
    -e OLLAMA_HOST="$OLLAMA_HOST" \
    "$LITELLM_IMAGE"

echo ""
echo "====================================="
echo "  LiteLLM Service deployed successfully!"
echo "====================================="
echo "  Health Check: http://localhost:$PORT/healthz"
echo "  Models List:  http://localhost:$PORT/v1/models"
echo "  Logs:         docker logs -f litellm-standalone"
echo "  Stop:         docker stop litellm-standalone && docker rm litellm-standalone"
echo "====================================="