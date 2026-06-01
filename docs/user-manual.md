# EasyAI 用户手册

## 1. 你能用它做什么

- 用 OpenAI 兼容接口调用模型：`/v1/chat/completions`、`/v1/embeddings`、`/v1/models`
- 使用 Dashboard 管理 API Key、租户和用量
- 使用 Chat UI 进行会话测试（`/chat`）
- 使用 Batch API 提交异步任务（`/v1/batches`）

## 2. 快速开始

### 2.1 启动（开发）

```bash
docker compose up -d --build
curl -sS http://localhost:3004/healthz
```

### 2.2 打开入口

- 首页：`http://localhost:3004/`
- API 文档：`http://localhost:3004/docs`
- Dashboard：`http://localhost:3004/dashboard`
- Chat：`http://localhost:3004/chat`

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
- 开发环境初始 key 来自 `config/easyai.development.yaml` 的 `secrets.api_keys`

### 3.2 Dashboard 鉴权

- 用户名固定：`admin`
- 密码来自 `secrets.admin_password`
- `/admin/api/*` 写操作还需要：`x-oneapi-admin-action: 1`

## 4. 常用接口

### 4.1 Gateway

- `POST /v1/chat/completions`
- `POST /v1/embeddings`
- `GET /v1/models`

### 4.2 Batch

- `POST /v1/batches`
- `GET /v1/batches/:batchId`
- `GET /v1/batches/:batchId/output`

Batch 可用前提：`secrets.internal_token` 已配置且 `batch_worker` 正常运行。

### 4.3 Chat API（供 Chat UI 使用）

- `GET /chat-api/models`
- `GET/POST/DELETE /chat-api/conversations`
- `GET /chat-api/conversations/:id/messages`
- `POST /chat-api/conversations/:id/chat`

## 5. 配置约定（重要）

- 统一配置文件：`config/easyai.development.yaml`
- `models` 是对外可见模型名（客户端请求时填这里的 key）
- 生产部署请使用 `config/easyai.production.local.yaml`（不入仓）

## 6. 常见问题

- `401 unauthorized`：检查 API Key 或 Dashboard 账号密码
- `429 rate limited`：触发 RPM/TPM 限流，需调整租户/Key 配额
- `503 batch worker not configured`：未配置 `secrets.internal_token` 或 worker 未运行
- `400 model not allowed`：模型名不在 `models` 配置中

## 7. 相关文档

- [部署指南](./deployment.md)
- [运行手册](./operations.md)
- [YAML 密钥管理](./yaml-secret-management.md)
