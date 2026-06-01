# 架构说明

## 1. 组件

- `oneapi-gateway`：统一入口，提供鉴权、限流、缓存、Batch API、Dashboard API、Chat API
- `litellm-service`：加载 YAML 中的 `models/providers`，执行模型调用与别名解析
- `batch-worker`：消费 Redis 队列，调用网关执行批任务，并写回 Postgres
- `redis`：限流、缓存、Batch 队列
- `postgres`：API Key、租户、会话、用量、Batch 结果
- `ollama`：本地模型后端（由 LiteLLM 调用）

## 2. 主要请求链路

### 2.1 Chat Completions

1. 客户端调用 `POST /v1/chat/completions`
2. 网关完成鉴权、限流、Guardrails、缓存判定
3. 未命中缓存时转发到 LiteLLM
4. LiteLLM 根据 `models` 配置解析目标模型并调用上游
5. 网关记录用量并返回结果

### 2.2 Batch

1. 客户端调用 `POST /v1/batches`
2. 网关写入 Postgres 并把 `batch_id` 推入 Redis 队列
3. Worker 从队列消费并逐项调用网关
4. Worker 回写 `batch_items` 与 `batches` 状态
5. 客户端通过 `GET /v1/batches/:batchId/output` 获取 `JSONL` 输出

## 3. 路由入口

- 首页：`/`
- OpenAI 兼容接口：`/v1/*`
- API 文档：`/docs`、`/openapi.json`
- Dashboard：`/dashboard`、`/admin/api/*`
- Chat：`/chat`、`/chat-api/*`
- 指标与健康：`/metrics`、`/healthz`

## 4. 配置边界

- 统一配置源：YAML（容器内挂载为 `/app/config/easyai.yaml`）
- 网关读取：`app.*`、`secrets.*`
- LiteLLM 读取：`app.*`、`providers.*`、`models.*`

说明：模型白名单与别名由 LiteLLM 按 `models` 配置生效。
