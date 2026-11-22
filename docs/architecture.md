# 架构说明

## 1. 组件

- `oneapi-gateway`：统一入口，提供鉴权、限流、`/v1/*` 透传、Batch API、Chat API 与静态页面（首页 / 会话）
- `litellm`：官方 LiteLLM Proxy 镜像，作为模型接入面，负责 100+ provider 协议适配、模型别名、重试/故障转移、Redis 缓存、内容过滤护栏与 `/docs`
- `batch-worker`：消费 Redis 队列，调用网关执行批任务，并写回 Postgres
- `redis`：限流、LiteLLM 响应缓存、Batch 队列
- `postgres`：LiteLLM 的密钥/预算/用量日志 + EasyAI 的会话与 Batch 结果
- `ollama`：本地模型后端（由 LiteLLM 调用）

## 2. 主要请求链路

### 2.1 Chat Completions

1. 客户端调用 `POST /v1/chat/completions`
2. 网关完成鉴权、限流，并以 `secrets.master_key` 转发到 LiteLLM
3. LiteLLM 按启动时生成的 `model_list` 解析模型别名并调用上游（含重试、fallback、缓存、护栏）
4. 网关返回结果；用量与请求日志由 LiteLLM 落库（控制台可查）
5. `/docs`、`/openapi.json` 由 LiteLLM 生成，网关仅做透传

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
- 控制台：`/ui`、`/dashboard`（302 到 LiteLLM Admin UI）
- Chat：`/chat`、`/chat-api/*`
- 指标与健康：`/metrics`（透传 LiteLLM）、`/healthz`

## 4. 配置边界

- 统一配置源：一份 YAML（容器内挂载为 `/app/config/easyai.yaml`）
- 网关读取：`app.port`、`app.console_url`、`app.rate_limit_rpm`、`app.upstream_timeout_ms`、`secrets.api_keys`、`secrets.internal_token`、`secrets.master_key`、`secrets.postgres_password`
- LiteLLM 配置在启动时由 `scripts/render-litellm-config.py` 从同一份 YAML 生成：`providers.*`、`models.*`、`app.*`、`guardrails.*` → `model_list` / `litellm_settings` / `guardrails` / `router_settings`
- 说明：不存在第二份 LiteLLM 配置文件；模型别名、fallback、缓存开关、护栏关键词都只在这一份 YAML 里维护
