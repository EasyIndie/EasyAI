# EasyAI 用户手册

## 1. 你能用它做什么

- 用 OpenAI 兼容接口调用不同厂商的模型：`/v1/chat/completions`、`/v1/responses`、`/v1/embeddings`、`/v1/models` 等
- 用一份 YAML 定义模型别名，换厂商不用改客户端代码
- 在控制台（LiteLLM Admin UI，支持中文）管理密钥、预算、限流、用量和请求日志
- 使用 Chat UI 进行会话测试（`/chat`）
- 使用 Batch API 提交异步任务（`/v1/batches`）

## 2. 快速开始

### 2.1 启动（开发）

```bash
docker compose up -d --build
curl -sS http://localhost:3004/healthz
docker compose exec -T ollama ollama pull qwen2.5:0.5b
```

### 2.2 打开入口

- 首页：`http://localhost:3004/`
- Chat：`http://localhost:3004/chat`
- API 文档：`http://localhost:3004/docs`
- 控制台：`http://localhost:3005/ui`（也可从首页「控制台」按钮进入）

### 2.3 发起第一条请求

```bash
curl -sS http://localhost:3004/v1/chat/completions \
  -H "Authorization: Bearer dev-key" \
  -H "Content-Type: application/json" \
  -d '{"model":"chat","messages":[{"role":"user","content":"hello"}],"temperature":0}'
```

## 3. 鉴权与权限

### 3.1 API 调用鉴权

- 默认使用 API Key：`Authorization: Bearer <key>` 或 `x-api-key: <key>`
- 两种 Key 都可用：
  - YAML 里的 `secrets.api_keys`（最简单，适合个人/小团队）
  - 控制台创建的 LiteLLM 虚拟密钥（带预算、模型白名单、RPM/TPM 限制）
- 所有 `/v1/*`、`/chat-api/*` 请求都要求鉴权

### 3.2 控制台鉴权

- 用户名：`admin`
- 密码：`secrets.master_key`（可在控制台里再建 proxy_admin 账号并关闭环境变量登录）
- 界面右上角设置里可切换语言为「简体中文」

## 4. 常用接口

### 4.1 Gateway

- `POST /v1/chat/completions`
- `POST /v1/embeddings`
- `GET /v1/models`

除 `/v1/*` 之外的模型接入能力（Anthropic、Gemini、Responses、rerank、图像、音频）由 LiteLLM 提供，网关原样透传。

### 4.2 Batch

- `POST /v1/batches`
- `GET /v1/batches/:batchId`
- `GET /v1/batches/:batchId/output`

Batch 可用前提：`secrets.internal_token` 已配置且 `batch_worker` 正常运行。
`/v1/batches/:batchId/output` 返回 `application/jsonl`（每行一条结果）。

### 4.3 Chat API（供 Chat UI 使用）

- `GET /chat-api/models`
- `GET/POST/DELETE /chat-api/conversations`
- `GET /chat-api/conversations/:id/messages`
- `POST /chat-api/conversations/:id/chat`

## 5. 配置约定（重要）

- 统一配置文件：`config/easyai.development.yaml`
- `models` 是对外可见模型名（客户端请求时填这里的 key），启动时自动转成 LiteLLM 的 `model_list`
- `providers` 存放各厂商的 `api_base` / `api_key`
- 生产部署请使用 `config/easyai.production.local.yaml`（不入仓）
- 如果 `models.chat` 映射到 Ollama，本地需先 `ollama pull` 对应模型，否则会返回模型不存在

## 6. 常见问题

- `401 unauthorized`：检查 API Key；虚拟密钥请在控制台确认未过期/未吊销
- `429 rate limited`：网关 `app.rate_limit_rpm` 或虚拟密钥的 RPM/预算限制
- `503 batch worker not configured`：未配置 `secrets.internal_token` 或 worker 未运行
- 模型名不存在：确认 `models` 里配置了该别名
- 上游模型未就绪：常见于 Ollama 未拉取模型（`docker compose exec -T ollama ollama pull <model>`）

## 7. 相关文档

- [部署指南](./deployment.md)
- [运行手册](./operations.md)
- [YAML 密钥管理](./yaml-secret-management.md)
