# 部署指南（Deployment）

本文档汇总本仓库支持的部署方式，包含：
- **Combined 模式**（完整部署：OneAPI 网关 + LiteLLM + 数据库组件 + Batch Worker）
- **Lite 模式**（轻量推理：仅部署 LiteLLM + Ollama）
- **Kubernetes 部署**（kustomize）

## 1. Combined 模式（完整版）

此模式适合在生产环境中提供完整的 API 管理、鉴权、限流、审计、缓存以及异步任务（Batch）功能。

### 1.1 Docker Compose

在仓库根目录直接运行：

```bash
docker compose up -d --build
```

验证网关与代理层是否正常启动：

```bash
curl -sS http://localhost:3003/healthz
curl -sS http://localhost:4000/healthz
```

管理后台：
- Dashboard：`http://localhost:3003/dashboard`
- 内置聊天界面：`http://localhost:3003/chat`
- Swagger API 文档：`http://localhost:3003/docs`

默认 Compose 不再启动 AnythingLLM。项目内置聊天界面已覆盖基础对话、会话管理和流式输出；如需外部图形化聊天客户端，可参考 [5. 可选：AnythingLLM 接入](#5-可选anythingllm-接入)。

通过网关发起一次测试请求：

```bash
curl -sS http://localhost:3003/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer dev-key" \
  -d '{
    "model":"chat",
    "messages":[{"role":"user","content":"Say hello in one sentence."}],
    "temperature":0
  }'
```

### 1.2 Batch 异步任务服务

- 默认在 Combined 模式中已启用：`config/oneapi/oneapi.yaml` 包含 `internal_token` 且 compose 会自动启动 `batch_worker` 容器。
- 若需关闭 Batch 功能：清空 YAML 配置中的 `internal_token`，并在 compose 中移除/停止 `batch_worker`。未配置 token 时访问 `/v1/batches` 会返回 503 错误。

---

## 2. Lite 模式（轻量版）

此模式去除了所有网关管理和数据库组件，仅启动纯粹的模型推理环境，适合个人开发测试或内网纯计算节点。详细说明请参考 [Lite 轻量模式：快速启动与排障指南](./lite-mode-quickstart.md)。

### 2.1 Docker Compose

在仓库根目录运行：

```bash
docker compose -f docker-compose.lite.yml up -d --build
```

验证 LiteLLM 代理层是否正常启动：

```bash
curl -sS http://localhost:4000/healthz
```

Lite 模式不再默认启动 AnythingLLM。如需外部图形化客户端，可将客户端的 OpenAI-compatible Base URL 指向 `http://localhost:4000/v1`，模型使用 `local/ollama:qwen2.5:0.5b`。

直接向 LiteLLM 发起测试请求（无需 API Key，需使用配置全称）：

```bash
curl -sS http://localhost:4000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model":"local/ollama:qwen2.5:0.5b",
    "messages":[{"role":"user","content":"Say hello in one sentence."}],
    "temperature":0
  }'
```

---

## 3. Kubernetes (Kustomize) 部署

对于需要在 K8s 集群中运行的用户，本项目提供了现成的 Kustomize 编排清单。

### 3.1 镜像准备

请提前构建并推送以下镜像至您的集群可用镜像仓库：
- `easyai/litellm-service:latest`
- `easyai/oneapi-gateway:latest`
- `easyai/batch-worker:latest`

### 3.2 部署 Combined 模式

```bash
kubectl apply -k k8s/combined
```

**说明**：
- `k8s/combined/base` 包含完整组件：oneapi、litellm、ollama、redis、postgres、batch-worker 及 NetworkPolicy 安全基线
- OneAPI 与 Batch Worker 统一采用 **YAML-only** 配置来源（挂载 `oneapi-config` ConfigMap 的 `/app/config/oneapi.yaml`），不再依赖 `ONEAPI_*` 环境变量。
- NetworkPolicy 默认拒绝入站，仅放通必要的服务间访问
- 部署后，配置将通过 ConfigMap 自动从项目中的 `oneapi.yaml` 和 `litellm.yaml` 加载

### 3.3 生产环境叠加层 (Overlays)

对于真实的生产环境，强烈建议使用 overlay 以覆盖默认的示例凭证和端口配置：

```bash
kubectl apply -k k8s/combined/overlays/production
```

**安全强化**：
Production overlay 会将环境设置为 `production`，并采用更严格的容器安全上下文（seccomp、drop capabilities、只读根文件系统等）。如果您的集群策略或镜像行为不兼容，请按需调整 overlay 清单。

---

## 4. 配置文件入口

系统的所有行为均通过以下两个 YAML 文件集中控制，不再依赖环境 (`.env`) 文件：

- **OneAPI 网关配置**：[config/oneapi/oneapi.yaml](../config/oneapi/oneapi.yaml)
- **LiteLLM 代理配置**：[config/litellm/litellm.yaml](../config/litellm/litellm.yaml)

---

## 5. 可选：AnythingLLM 接入

EasyAI 默认使用内置 Chat UI（`/chat`），不再把 AnythingLLM 作为默认运行依赖。若仍希望使用 AnythingLLM，可通过可选 Compose overlay 启动：

```bash
docker compose -f docker-compose.yml -f docker-compose.anythingllm.yml up -d --build
```

访问地址：

```text
http://localhost:3000
```

该 overlay 会将 AnythingLLM 配置为连接 OneAPI：

- LLM Provider：`generic-openai`
- Base URL：`http://oneapi:3003/v1`
- API Key：`dev-key`
- 默认模型：`chat`

如果使用外部安装的 AnythingLLM，请在其设置中填入：

- Base URL：`http://<easyai-host>:3003/v1`
- API Key：`<your-api-key>`
- Model：`chat` 或 `coder`
