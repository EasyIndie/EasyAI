#!/bin/bash

# Exit on error
set -e

echo "====================================="
echo "  Deploying Standalone Ollama Service"
echo "====================================="

# Default values
PORT=${OLLAMA_PORT:-11434}
CONTAINER_NAME="ollama-standalone"
VOLUME_NAME="ollama_data_standalone"
IMAGE="ollama/ollama:latest"

# 1. Check if a container named 'ollama-standalone' is already running, if so, stop it
if [ "$(docker ps -aq -f name=$CONTAINER_NAME)" ]; then
    echo "=> Stopping existing '$CONTAINER_NAME' container..."
    docker stop $CONTAINER_NAME >/dev/null
    docker rm $CONTAINER_NAME >/dev/null
fi

# 2. Run the container
echo "=> Starting Ollama container on port $PORT (binding to localhost only)..."
docker run -d \
    --name $CONTAINER_NAME \
    -p "127.0.0.1:$PORT:11434" \
    -v $VOLUME_NAME:/root/.ollama \
    $IMAGE

echo ""
echo "====================================="
echo "  Ollama Service deployed successfully!"
echo "====================================="
echo "  Port:         $PORT"
echo "  Volume:       $VOLUME_NAME"
echo "  Logs:         docker logs -f $CONTAINER_NAME"
echo "  Pull Model:   docker exec -it $CONTAINER_NAME ollama pull <model_name>"
echo "  Stop:         docker stop $CONTAINER_NAME && docker rm $CONTAINER_NAME"
echo "====================================="
