# EasyAI Platform (LiteLLM + OneAPI Gateway)

This directory contains a modular AI API service platform composed of:

- **LiteLLM Service**: a standalone lightweight OpenAI-compatible LLM service for local or remote model backends.
- **OneAPI Gateway**: a unified gateway that authenticates, rate-limits, routes, transforms, caches, and records usage analytics for upstream LLM services (including the LiteLLM service in this repo).

## Quickstart (Combined Mode, Docker)

1. Copy environment example:

   ```bash
   cp .env.example .env
   ```

2. Start services:

   ```bash
   docker compose up --build
   ```

3. Call the gateway (replace API key):

   ```bash
   curl http://localhost:8080/v1/chat/completions \
     -H "Content-Type: application/json" \
     -H "Authorization: Bearer dev-key" \
     -d '{
       "model":"local/ollama:llama3.1",
       "messages":[{"role":"user","content":"Hello!"}],
       "temperature":0
     }'
   ```

## Services

- LiteLLM: `http://localhost:4000`
  - Health: `/healthz`
  - Metrics: `/metrics`
  - OpenAI-compatible: `/v1/*`
- OneAPI Gateway: `http://localhost:8080`
  - Health: `/healthz`
  - Metrics: `/metrics`
  - Dashboard: `/dashboard` (basic admin view)

## Documentation

See:
- [docs/user-manual.md](docs/user-manual.md)（产品使用手册 + 常用 API 速查）
- [docs/deployment.md](docs/deployment.md)（部署：Combined / Standalone / K8S）
- [docs/operations.md](docs/operations.md)（运行手册：发布前检查 + 排障）
- [docs/development.md](docs/development.md)（开发/测试/安全基线/文档校验）
- [docs/architecture.md](docs/architecture.md)（架构与请求流）
