# EasyAI 产品使用手册（面向管理员 / 租户 / 调用方）

## 1. 产品定位

EasyAI 是一个面向多租户的大模型调用网关与治理平台，提供：
- OpenAI 兼容 API（统一入口）
- 成本与性能优化（流式缓存、打字机回放）
- 配额治理（租户/Key 的 RPM、租户 TPM）
- 可观测与审计（TTFT/TPS 指标、用量落库）
- 安全合规（注入拦截、内网 IP 拦截、PII 脱敏）
- 批处理（Batch API + Worker）

## 2. 角色与权限

### 2.1 管理员（Admin）

管理员通过 BasicAuth 登录 Dashboard，负责：
- 创建/禁用 API Key
- 绑定 Key 到租户
- 配置租户 RPM/TPM 配额与禁用租户
- 查看用量统计与运行状态

### 2.2 租户（Tenant）

租户是配额与隔离的基本单位：
- 一个租户可绑定多个 API Key（同租户共享 RPM 配额）
- 支持租户级 RPM/TPM 与禁用开关

### 2.3 调用方（Client）

调用方使用 API Key 或 OAuth/JWT 调用 `/v1/*`：
- 在线请求：chat/completions、embeddings
- 离线批处理：batches（需要启用 batch worker；本仓库 Quickstart 默认已启用）

## 3. 快速上手（典型路径）

### 3.1 启动系统（Docker Compose）

```bash
cp .env.example .env
docker compose up -d --build
```

健康检查：
```bash
curl -sS http://localhost:8080/healthz
```

用户侧 API 文档：
- Swagger UI：`http://localhost:8080/docs`
- OpenAPI：`http://localhost:8080/openapi.json`

### 3.2 登录管理后台

- 地址：`http://localhost:8080/dashboard`
- 认证：HTTP Basic（`ONEAPI_ADMIN_USER` / `ONEAPI_ADMIN_PASS`）

### 3.3 创建 API Key 并绑定租户

在 Dashboard：
1. 进入 **API Keys** 创建 Key
2. 创建/选择一个租户（Tenants）
3. 将 Key 绑定到该租户
4. 为租户设置 RPM/TPM（可选）

### 3.4 客户端发起一次调用

```bash
curl -sS http://localhost:8080/v1/chat/completions \
  -H "Authorization: Bearer <your_api_key>" \
  -H "Content-Type: application/json" \
  -d '{"model":"local/ollama:qwen2.5:0.5b","messages":[{"role":"user","content":"hello"}],"temperature":0}'
```

推荐的本地测试默认模型（磁盘占用小、CPU 可跑）：
- 通用对话：`local/ollama:qwen2.5:0.5b`
- 编程任务：`local/ollama:qwen2.5-coder:1.5b`

为减少业务侧配置成本，默认开启 `ONEAPI_MODEL_MAP` 映射：
- `chat` → `local/ollama:qwen2.5:0.5b`
- `coder` → `local/ollama:qwen2.5-coder:1.5b`

因此业务侧可以直接把 `model` 写成 `chat` 或 `coder`（由网关自动重写为真实模型名）。

## 4. 核心能力说明（产品视角）

### 4.1 统一 OpenAI 兼容入口

- 对外统一 `http(s)://<gateway>/v1/*`
- 对上游屏蔽模型提供方差异（LiteLLM/Ollama/其它 OpenAI-compatible 服务）
- 支持模型别名映射与 fallback（在配置中维护）

### 4.2 配额治理（RPM/TPM）

**RPM（每分钟请求数）**
- 当 Key 绑定租户时：按租户聚合限流（同租户 Key 共享额度）
- 否则：按调用主体（API Key/OAuth subject）限流

**TPM（每分钟 token 数）**
- 以 token 用量为基础做约束（常用于控制成本）

**禁用**
- 管理员可直接禁用租户，要求“快速生效”

常见响应头：
- `X-RateLimit-Limit` / `X-RateLimit-Remaining` / `X-RateLimit-Reset`
- `X-TokenLimit-*`（当启用 TPM 相关逻辑时）

### 4.3 成本优化：缓存与“打字机回放”

**缓存策略**
- 面向确定性请求（典型：`temperature=0`）启用 Redis 缓存
- 缓存覆盖非流式与流式（SSE）输出

**打字机回放（缓存命中 + stream:true）**
- `fixed`：每个 chunk 固定延迟
- `original`：复刻上游真实 chunk 间隔（体验更像真实模型）

关键配置：
- `ONEAPI_CACHE_ENABLED`
- `ONEAPI_CACHE_TTL_SECONDS`
- `ONEAPI_CACHE_REPLAY_MODE=fixed|original`
- `ONEAPI_CACHE_REPLAY_CHUNK_DELAY_MS`
- `ONEAPI_CACHE_REPLAY_MAX_TOTAL_MS`

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

关键配置：
- `ONEAPI_GUARDRAILS_ENABLED=0|1`
- `ONEAPI_GUARDRAILS_BLOCK_INTERNAL_IP=0|1`
- `ONEAPI_GUARDRAILS_INJECTION_KEYWORDS=...`
- `ONEAPI_GUARDRAILS_PII_MASK_ENABLED=0|1`

### 4.6 批处理（Batch API）

适用场景：
- 离线评测、批量生成、数据处理、削峰填谷

工作方式：
1. 客户端提交 `/v1/batches`（包含多个子请求）
2. 网关把 batch_id 入 Redis 队列
3. Worker 异步消费队列并执行子请求
4. 客户端用 `batch_id` 查询进度并下载结果 JSONL

关键配置：
- `ONEAPI_INTERNAL_TOKEN`（启用 Batch 的必备开关）
- `ONEAPI_BASE_URL`（worker 访问网关的内部地址）

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
- 503：上游不可用或 Batch 未配置 `ONEAPI_INTERNAL_TOKEN`

## 6. 验收与排障入口

建议从运行手册进入统一的“发布前检查 + 排障”：
- [docs/operations.md](operations.md)

自动化文档一致性校验：
```bash
cd oneapi-gateway
npm run doc-audit
```

## 8. API 快速参考（常用）

### 8.1 Gateway（OpenAI-compatible）

常用：
- `POST /v1/chat/completions`
- `POST /v1/embeddings`
- `GET /v1/models`

鉴权：
- API key：`Authorization: Bearer <key>` 或 `x-api-key: <key>`
- OAuth/JWT：`Authorization: Bearer <jwt>`（JWKS/issuer/audience 按环境变量配置）

缓存：
- `ONEAPI_CACHE_ENABLED=1`
- 典型命中条件：确定性请求（如 `temperature: 0`），请求体一致
- `stream:true` 也可缓存，命中后支持回放节奏 `fixed|original`

### 8.2 Batch

- `POST /v1/batches`
- `GET /v1/batches/:batchId`
- `GET /v1/batches/:batchId/output`

Batch 需要配置 `ONEAPI_INTERNAL_TOKEN` 并运行 batch worker。

### 8.3 Admin（Dashboard API）

- `GET /dashboard`（BasicAuth）
- `GET /admin/api/usage?sinceMinutes=60`
- `GET /admin/api/keys` / `POST /admin/api/keys` / `POST /admin/api/keys/:id/revoke`
- `DELETE /admin/api/keys/:id`（body：`{ "force": true }`）
- `GET /admin/api/tenants` / `PUT /admin/api/tenants/:tenantId`
- `DELETE /admin/api/tenants/:tenantId`（body：`{ "force": true }`）
- `POST /admin/api/tenants/:tenantId/unbind_keys`

注意：
- `/admin/api/*` 的写操作（POST/PUT/DELETE）除 BasicAuth 外，还必须携带 `x-oneapi-admin-action: 1`。

## 7. 术语解释（Glossary）

### 7.1 配额与计量

- **RPM（Requests Per Minute）**：每分钟请求数上限。超过后通常返回 `429`，并带 `X-RateLimit-*` 响应头提示剩余配额与重置时间。
- **TPM（Tokens Per Minute）**：每分钟 token 消耗上限。token 一般来自响应体 `usage.total_tokens`（prompt + completion）。超过后通常返回 `429`。
- **Token**：大模型计费/计算的最小粒度。常见拆分：
  - **prompt_tokens**：输入被分词后的 token 数
  - **completion_tokens**：输出生成的 token 数
  - **total_tokens**：两者之和

### 7.2 性能与观测

- **TTFT（Time To First Token）**：首字延迟，指从请求开始到“第一个输出 chunk/token”到达的时间。
- **TPS（Tokens Per Second）**：生成速度，近似为 `total_tokens / (latency - ttft)`（或用首 token 之后的耗时计算）。

### 7.3 协议与形态

- **SSE / stream:true**：Server-Sent Events 流式响应。服务端会持续推送 `data: ...` 事件，直到 `data: [DONE]` 结束。
- **缓存命中（Cache hit）/ 未命中（Cache miss）**：命中时直接返回 Redis 中缓存结果；未命中时转发上游并在完成后写入缓存。

### 7.4 多租户与鉴权

- **Tenant（租户）**：配额与隔离的基本单位。一个租户可绑定多个 Key；当 Key 绑定租户时，RPM/TPM 会按租户维度统计与约束（同租户共享配额）。
- **API Key**：调用方凭证，可由管理员在 Dashboard 创建并发放，也可通过环境变量配置静态 key（兼容模式）。
