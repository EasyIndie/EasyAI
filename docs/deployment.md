# 部署指南（Deployment）

本文档聚合本仓库的部署方式，包含：
- Combined（OneAPI → LiteLLM）一键部署
- Standalone（单独部署 OneAPI 或 LiteLLM）
- Docker / Kubernetes（kustomize）

## 1. Combined Mode（推荐）

### 1.1 Docker Compose

在仓库根目录：

```bash
cp .env.example .env
docker compose up -d --build
```

验证：

```bash
curl -sS http://localhost:8080/healthz
curl -sS http://localhost:4000/healthz
```

通过网关发起一次请求：

```bash
curl -sS http://localhost:8080/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer dev-key" \
  -d '{
    "model":"local/ollama:qwen2.5:0.5b",
    "messages":[{"role":"user","content":"Say hello in one sentence."}],
    "temperature":0
  }'
```

### 1.2 Batch（可选）

如需启用 `/v1/batches`，设置 `ONEAPI_INTERNAL_TOKEN`，并确保 `batch_worker` 使用相同 token。

### 1.3 Kubernetes（kustomize）

1) 构建并推送镜像（按需）：
- `easyai/litellm-service:latest`
- `easyai/oneapi-gateway:latest`
- `easyai/batch-worker:latest`（可选，Batch 需要）

2) 部署：

```bash
kubectl apply -k k8s/combined
```

说明：
- `k8s/combined` 默认包含 `ollama` 与 `ollama2` 两个后端，以匹配 LiteLLM 的 multi-backend 配置。
- Batch 依赖 `ONEAPI_INTERNAL_TOKEN`，示例 secret 仅用于演示，真实环境请替换为安全值。

## 2. Standalone OneAPI Gateway

### 2.1 依赖

- Redis（限流/缓存/部分动态配置）
- Postgres（usage_events 用量审计与 Dashboard 数据源）
- 一个或多个 OpenAI-compatible 上游（例如本仓库 LiteLLM）

### 2.2 Docker

构建：

```bash
cd oneapi-gateway
docker build -t easyai/oneapi-gateway:latest .
```

运行（示例指向远端上游）：

```bash
docker run --rm -p 8080:8080 \
  -e ONEAPI_ADMIN_USER=admin \
  -e ONEAPI_ADMIN_PASS=admin \
  -e ONEAPI_AUTH_MODE=apikey \
  -e ONEAPI_API_KEYS=dev-key \
  -e ONEAPI_UPSTREAMS=http://your-upstream:4000 \
  -e REDIS_URL=redis://your-redis:6379 \
  -e DATABASE_URL=postgres://oneapi:oneapi@your-postgres:5432/oneapi \
  easyai/oneapi-gateway:latest
```

可选：
- 启用 Guardrails：`ONEAPI_GUARDRAILS_ENABLED=1`
- 启用 Batch：`ONEAPI_INTERNAL_TOKEN=<secret>` 并运行 batch-worker

验证：

```bash
curl -sS http://localhost:8080/healthz
curl -sS -u admin:admin http://localhost:8080/admin/api/usage?sinceMinutes=60 | head
```

### 2.3 Kubernetes（kustomize）

```bash
kubectl apply -k k8s/oneapi
```

## 3. Standalone LiteLLM Service

### 3.1 Docker

```bash
cd litellm-service
docker build -t easyai/litellm-service:latest .
docker run --rm -p 4000:4000 \
  -e LITELLM_CONFIG_PATH=/app/config/litellm.yaml \
  -e OLLAMA_HOST=http://host.docker.internal:11434 \
  -e OLLAMA_HOST_2=http://host.docker.internal:11435 \
  easyai/litellm-service:latest
```

`OLLAMA_HOST_2` 是可选项，仅当 LiteLLM 配置启用了第二路后端时需要。

验证：

```bash
curl -sS http://localhost:4000/healthz
curl -sS http://localhost:4000/v1/models | head
```

### 3.2 Kubernetes（kustomize）

```bash
kubectl apply -k k8s/litellm
```

### 3.3 本地模型（Ollama）

预拉取模型示例：

```bash
curl http://localhost:11434/api/pull -d '{"name":"qwen2.5:0.5b"}'
```

## 4. 配置入口

- OneAPI env（示例）：[oneapi.env.example](file:///Users/bytedance/Documents/EasyAI/config/oneapi/oneapi.env.example)
- Combined env（示例）：[env.example](file:///Users/bytedance/Documents/EasyAI/config/combined/env.example)
- LiteLLM 配置：[litellm.yaml](file:///Users/bytedance/Documents/EasyAI/config/litellm/litellm.yaml)
