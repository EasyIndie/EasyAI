# EasyAI 产品使用手册（面向管理员 / 租户 / 调用方）

## 1. 产品定位

EasyAI 是一个统一的大模型网关、聊天入口和治理控制台，适合本地开发、团队试用和生产接入。它把上游模型服务、OpenAI-compatible API、聊天界面、管理后台、批处理、缓存和审计能力放在同一个入口里，方便业务接入、管理员治理和开发者调试。

核心能力包括：
- 统一 OpenAI-compatible 入口，屏蔽上游模型服务差异
- 支持 API Key / OAuth 调用，按租户做配额和限流治理
- 内置聊天界面，支持会话历史、流式输出和模型测试
- 提供 Batch API，用于离线批量请求和异步处理
- 提供缓存、回放、指标和用量统计，便于控制成本和排障
- 提供注入拦截、内网 IP 拦截和 PII 脱敏等安全能力

## 2. 角色与权限

### 2.1 管理员（Admin）

管理员通过 BasicAuth 登录 Dashboard，负责：
- 创建/禁用 API Key
- 绑定 Key 到租户
- 配置租户 RPM/TPM 配额与禁用租户
- 查看用量统计与运行状态
- 查看系统入口、服务状态与管理操作入口

### 2.2 租户（Tenant）

租户是配额与隔离的基本单位：
- 一个租户可绑定多个 API Key（同租户共享 RPM 配额）
- 支持租户级 RPM/TPM 与禁用开关

### 2.3 调用方（Client）

调用方使用 API Key 或 OAuth/JWT 调用 `/v1/*`：
- 在线请求：chat/completions、embeddings
- 离线批处理：batches（需要启用 batch worker；本仓库 Quickstart 默认已启用）
- 日常交互：进入 Chat 页面进行对话，或者在同页切换到模型测试

## 3. 快速上手（典型路径）

### 3.1 启动系统（Docker Compose）

```bash
docker compose up -d --build
```

健康检查：
```bash
curl -sS http://localhost:3004/healthz
```

建议先打开首页：
- 首页概览：`http://localhost:3004/`
- Swagger UI：`http://localhost:3004/docs`
- OpenAPI：`http://localhost:3004/openapi.json`
- 内置聊天 UI：`http://localhost:3004/chat`
- 管理后台：`http://localhost:3004/dashboard`

### 3.2 登录管理后台

- 地址：`http://localhost:3004/dashboard`
- 认证：HTTP Basic（用户名默认 `admin`，密码来自 `config/easyai.yaml` 中的 `secrets.admin_password`）

### 3.3 创建 API Key 并绑定租户

在 Dashboard：
1. 进入 **API Keys** 创建 Key
2. 创建/选择一个租户（Tenants）
3. 将 Key 绑定到该租户
4. 为租户设置 RPM/TPM（可选）

### 3.4 选择使用方式

普通用户：
- 打开 `/chat`
- 输入 API Key
- 选择模型后开始对话
- 如果需要单次验证模型效果，切换到同页的模型测试视图

开发者：
- 打开 `/docs`
- 查看请求结构和返回格式
- 直接用 curl 或 SDK 调用 `/v1/chat/completions`

管理员：
- 打开 `/dashboard`
- 管理 API Key、租户、用量统计和后台操作

### 3.5 客户端发起一次调用

```bash
curl -sS http://localhost:3004/v1/chat/completions \
  -H "Authorization: Bearer <your_api_key>" \
  -H "Content-Type: application/json" \
  -d '{"model":"chat","messages":[{"role":"user","content":"hello"}],"temperature":0}'
```

推荐的本地测试默认模型（磁盘占用小、CPU 可跑）：
- 通用对话：`chat`
- 编程任务：`coder`

这些模型名来自 `config/easyai.yaml` 的 `models` 段，业务侧可以直接把 `model` 写成 `chat` 或 `coder`。

## 4. 核心能力说明（产品视角）

### 4.1 统一 OpenAI 兼容入口

- 对外统一 `http(s)://<gateway>:3003/v1/*`
- 对上游屏蔽模型提供方差异（LiteLLM/Ollama/其它 OpenAI-compatible 服务）
- 支持模型别名映射与 fallback（在配置中维护）

### 4.2 配额治理（RPM/TPM）

**RPM（每分钟请求数）**
- 当 Key 绑定租户时：按租户聚合限流（同租户 Key 共享额度）
- 否则：按调用主体（API Key/OAuth subject）限流

**TPM（每分钟 token 数）**
- 以 token 用量为基础做约束（常用于控制成本）
- 仅支持租户级 TPM 限制

**禁用**
- 管理员可直接禁用租户，要求"快速生效"

常见响应头：
- `X-RateLimit-Limit` / `X-RateLimit-Remaining` / `X-RateLimit-Reset`
- `X-TokenLimit-Limit` / `X-TokenLimit-Used` / `X-TokenLimit-Reset`（当启用 TPM 限流时）

### 4.3 成本优化：缓存与"打字机回放"

**缓存策略**
- 面向确定性请求（典型：`temperature=0`）启用 Redis 缓存
- 缓存覆盖非流式与流式（SSE）输出

**打字机回放（缓存命中 + stream:true）**
- `fixed`：每个 chunk 固定延迟
- `original`：复刻上游真实 chunk 间隔（体验更像真实模型）

缓存默认启用，确定性请求会自动写入 Redis，流式缓存命中会按原始节奏回放。

### 4.4 可观测与审计

**指标（Prometheus）**
- `/metrics` 导出：
  - `easyai_ttft_seconds`：首字延迟
  - `easyai_tps`：生成速率（tokens/sec）
  - cache/upstream/http 相关指标

**审计与用量**
- 所有请求写入 Postgres `usage_events`
- Dashboard 展示聚合用量（近 N 分钟）

### 4.5 安全合规：Guardrails

**输入侧**
- Prompt 注入关键字拦截
- 内网 IP/localhost 访问意图拦截（返回 400）

**输出侧**
- PII 脱敏（手机号/身份证/邮箱等）
- 覆盖非流式、流式透传、缓存命中回放，避免敏感信息落盘/落缓存

Guardrails 默认启用输入侧拦截；输出侧 PII 脱敏默认关闭。

### 4.6 批处理（Batch API）

适用场景：
- 离线评测、批量生成、数据处理、削峰填谷

工作方式：
1. 客户端提交 `/v1/batches`（包含多个子请求）
2. 网关把 batch_id 入 Redis 队列
3. Worker 异步消费队列并执行子请求
4. 客户端用 `batch_id` 查询进度并下载结果 JSONL

**关键配置（在 `config/easyai.yaml` 中设置）：**
- `secrets.internal_token`（启用 Batch 的必备开关）

### 4.7 内置聊天（Chat UI）

提供基于 Web 的对话交互界面：
- 地址：`http://localhost:3004/chat`
- 调用 `/chat-api/*` 接口，使用与 `/v1/*` 相同的鉴权方式
- 支持对话历史管理（创建、列表、删除）
- 支持消息流式输出
- 每个用户独立维护对话列表

## 5. 典型 SOP（运营/运维）

### 5.1 新租户接入

1. 在 Tenants 创建租户 `tenant_id`
2. 设置 RPM/TPM
3. 创建 API Key 并绑定租户
4. 将 API Key 发给业务方（建议走密钥管理系统）

### 5.2 清理无用 Key/Tenant

- API Key：
  - 先 Revoke 停用
  - 再 Delete 删除（默认要求已 revoke；必要时可 force）
- Tenant：
  - 若 tenant 下仍有 key 绑定，默认不允许删除
  - 可先解绑相关 key，再删除；或使用 Force Delete（会解绑后删除）

### 5.3 事故处理（常见）

- 401：Key 不存在/禁用；或 OAuth 配置错误
- 429：租户/Key 触发 RPM/TPM；调整配额或扩容上游
- 503：上游不可用或 Batch 未配置 `secrets.internal_token`

### 5.4 一键清库与重置

项目提供了一键清库脚本：[reset-db.sh](../scripts/reset-db.sh)

适用场景：
- 希望清空 Dashboard 用量统计
- 希望重置租户、API Key、Batch 等业务数据
- 希望在开发测试环境中快速回到干净状态

常用命令：

仅清空用量统计：

```bash
./scripts/reset-db.sh --usage-only
```

清空 OneAPI 业务表：

```bash
./scripts/reset-db.sh
```

清空 OneAPI 业务表并同时清空 Redis：

```bash
./scripts/reset-db.sh --all --with-redis
```

说明：
- 脚本基于当前项目根目录的 `docker-compose.yml`
- 默认会清空 `batch_items`、`batches`、`usage_events`、`api_keys`、`tenants`
- 不会删除 Ollama 模型卷，不会删除代码和 YAML 配置
- 如果您只想让 Dashboard 用量归零，请使用 `--usage-only`

## 6. 验收与排障入口

建议从运行手册进入统一的"发布前检查 + 排障"：
- [docs/operations.md](operations.md)

自动化文档一致性校验：
```bash
cd oneapi-gateway
npm run doc-audit
```

## 7. API 快速参考（常用）

### 7.1 Gateway（OpenAI-compatible）

常用：
- `POST /v1/chat/completions`
- `POST /v1/embeddings`
- `GET /v1/models`

鉴权：
- API key：`Authorization: Bearer <key>` 或 `x-api-key: <key>`
- OAuth/JWT：`Authorization: Bearer <jwt>`（JWKS/issuer/audience 按环境变量配置）

缓存：
- `config/easyai.yaml` 使用默认缓存策略
- 典型命中条件：确定性请求（如 `temperature: 0`），请求体一致
- `stream:true` 也可缓存，命中后支持回放节奏 `fixed|original`

响应头：
- `X-Cache: hit|miss`
- `X-Upstream`：实际处理请求的上游地址
- `X-RateLimit-Limit / X-RateLimit-Remaining / X-RateLimit-Reset`

### 7.2 Batch

- `POST /v1/batches`
- `GET /v1/batches/:batchId`
- `GET /v1/batches/:batchId/output`

Batch 需要在 `config/easyai.yaml` 中配置 `secrets.internal_token` 并运行 batch worker。

### 7.3 Admin（Dashboard API）

```bash
# 用量统计
curl -u admin:admin http://localhost:3004/admin/api/usage?sinceMinutes=60

# API Key 管理
curl -u admin:admin http://localhost:3004/admin/api/keys
curl -u admin:admin -X POST http://localhost:3004/admin/api/keys \
  -H "x-oneapi-admin-action: 1"
curl -u admin:admin -X POST http://localhost:3004/admin/api/keys/1/revoke \
  -H "x-oneapi-admin-action: 1"

# 删除 Key（默认需先 revoke；force 跳过检查）
curl -u admin:admin -X DELETE http://localhost:3004/admin/api/keys/1 \
  -H "x-oneapi-admin-action: 1" -H "Content-Type: application/json" \
  -d '{"force": false}'

# 租户管理
curl -u admin:admin http://localhost:3004/admin/api/tenants
curl -u admin:admin -X PUT http://localhost:3004/admin/api/tenants/t1 \
  -H "x-oneapi-admin-action: 1" -H "Content-Type: application/json" \
  -d '{"rpm_limit": 100, "tpm_limit": 50000, "disabled": false}'
curl -u admin:admin -X DELETE http://localhost:3004/admin/api/tenants/t1 \
  -H "x-oneapi-admin-action: 1" -H "Content-Type: application/json" \
  -d '{"force": true}'
curl -u admin:admin -X POST http://localhost:3004/admin/api/tenants/t1/unbind_keys \
  -H "x-oneapi-admin-action: 1"
```

注意：
- `/admin/api/*` 的写操作（POST/PUT/DELETE）除 BasicAuth 外，还必须携带 `x-oneapi-admin-action: 1`。

### 7.4 Dashboard Playground

管理员可通过 Playground 在 Dashboard 内直接测试模型：

```bash
# 列出可用模型
curl -u admin:admin http://localhost:3004/admin/api/playground/models

# 发送测试请求（非流式）
curl -u admin:admin -X POST http://localhost:3004/admin/api/playground/chat \
  -H "x-oneapi-admin-action: 1" -H "Content-Type: application/json" \
  -d '{"model":"chat","messages":[{"role":"user","content":"hello"}]}'

# 流式测试
curl -u admin:admin -N -X POST http://localhost:3004/admin/api/playground/chat \
  -H "x-oneapi-admin-action: 1" -H "Content-Type: application/json" \
  -d '{"model":"chat","messages":[{"role":"user","content":"hello"}],"stream":true}'
```

### 7.5 聊天 API（Chat UI）

内置聊天界面使用的 API，主要用于 `/chat` 页面的前端交互：

```bash
# 对话列表
curl -H "Authorization: Bearer <api-key>" http://localhost:3004/chat-api/conversations

# 创建对话
curl -X POST -H "Authorization: Bearer <api-key>" http://localhost:3004/chat-api/conversations

# 删除对话
curl -X DELETE -H "Authorization: Bearer <api-key>" http://localhost:3004/chat-api/conversations/<id>

# 获取消息历史
curl -H "Authorization: Bearer <api-key>" http://localhost:3004/chat-api/conversations/<id>/messages

# 发送消息（非流式）
curl -X POST -H "Authorization: Bearer <api-key>" -H "Content-Type: application/json" \
  http://localhost:3004/chat-api/conversations/<id>/chat \
  -d '{"model":"chat","message":"hello"}'

# 发送消息（流式）
curl -N -X POST -H "Authorization: Bearer <api-key>" -H "Content-Type: application/json" \
  http://localhost:3004/chat-api/conversations/<id>/chat \
  -d '{"model":"chat","message":"hello","stream":true}'
```

## 8. 术语解释（Glossary）

### 8.1 配额与计量

- **RPM（Requests Per Minute）**：每分钟请求数上限。超过后通常返回 `429`，并带 `X-RateLimit-*` 响应头提示剩余配额与重置时间。
- **TPM（Tokens Per Minute）**：每分钟 token 消耗上限。token 一般来自响应体 `usage.total_tokens`（prompt + completion）。超过后通常返回 `429`。
- **Token**：大模型计费/计算的最小粒度。常见拆分：
  - **prompt_tokens**：输入被分词后的 token 数
  - **completion_tokens**：输出生成的 token 数
  - **total_tokens**：两者之和

### 8.2 性能与观测

- **TTFT（Time To First Token）**：首字延迟，指从请求开始到"第一个输出 chunk/token"到达的时间。
- **TPS（Tokens Per Second）**：生成速度，近似为 `total_tokens / (latency - ttft)`（或用首 token 之后的耗时计算）。

### 8.3 协议与形态

- **SSE / stream:true**：Server-Sent Events 流式响应。服务端会持续推送 `data: ...` 事件，直到 `data: [DONE]` 结束。
- **缓存命中（Cache hit）/ 未命中（Cache miss）**：命中时直接返回 Redis 中缓存结果；未命中时转发上游并在完成后写入缓存。

### 8.4 多租户与鉴权

- **Tenant（租户）**：配额与隔离的基本单位。一个租户可绑定多个 Key；当 Key 绑定租户时，RPM/TPM 会按租户维度统计与约束（同租户共享配额）。
- **API Key**：调用方凭证，可由管理员在 Dashboard 创建并发放，也可通过 `config/easyai.yaml` 的 `secrets.api_keys` 配置静态 key。
