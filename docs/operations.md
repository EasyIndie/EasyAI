# 运行手册（Operations）

本文档聚合发布前检查与常见故障处理，减少分散文档带来的重复与偏差。

## 1. 发布前检查（Preflight）

### 1.1 关键环境变量（速查）

**OneAPI Gateway**
- `ONEAPI_ADMIN_USER` / `ONEAPI_ADMIN_PASS`：Dashboard 与 `/admin/api/*` 的 BasicAuth
- `ONEAPI_AUTH_MODE`：`apikey` / `oauth`
- `ONEAPI_API_KEYS`：兼容模式静态 key（可选；也可在 Dashboard 创建 DB key）
- `ONEAPI_UPSTREAMS`：上游列表（默认指向 litellm）
- `ONEAPI_RATE_LIMIT_RPM`：默认 RPM
- `ONEAPI_CACHE_ENABLED` / `ONEAPI_CACHE_TTL_SECONDS`
- `ONEAPI_CACHE_REPLAY_MODE=fixed|original` / `ONEAPI_CACHE_REPLAY_MAX_TOTAL_MS`
- Guardrails：`ONEAPI_GUARDRAILS_*`
- Batch：`ONEAPI_INTERNAL_TOKEN`（启用 batches 必配）
- `REDIS_URL` / `DATABASE_URL`

**Batch Worker**
- `ONEAPI_BASE_URL`：worker 调用网关的内部地址（compose 默认 `http://oneapi:8080`）
- `ONEAPI_INTERNAL_TOKEN`：必须与网关一致

### 1.2 启动与健康检查

```bash
docker compose up -d --build redis postgres litellm oneapi batch_worker
```

```bash
curl -sS http://localhost:8080/healthz
curl -sS http://localhost:8080/metrics | head
```

### 1.3 常用验收 curl

**基础转发（非流式）**

```bash
curl -sS http://localhost:8080/v1/chat/completions \
  -H "Authorization: Bearer dev-key" \
  -H "Content-Type: application/json" \
  -d '{"model":"local/ollama:qwen2.5:0.5b","messages":[{"role":"user","content":"hello"}],"temperature":0}'
```

**编程模型（轻量）**

```bash
curl -sS http://localhost:8080/v1/chat/completions \
  -H "Authorization: Bearer dev-key" \
  -H "Content-Type: application/json" \
  -d '{"model":"local/ollama:qwen2.5-coder:1.5b","messages":[{"role":"user","content":"Write a TypeScript function to add two numbers."}],"temperature":0}'
```

**使用默认模型别名（推荐）**

```bash
curl -sS http://localhost:8080/v1/chat/completions \
  -H "Authorization: Bearer dev-key" \
  -H "Content-Type: application/json" \
  -d '{"model":"coder","messages":[{"role":"user","content":"Write a TypeScript function to add two numbers."}],"temperature":0}'
```

**Streaming + 缓存命中（两次相同请求）**

```bash
curl -N http://localhost:8080/v1/chat/completions \
  -H "Authorization: Bearer dev-key" \
  -H "Content-Type: application/json" \
  -d '{"model":"local/ollama:qwen2.5:0.5b","messages":[{"role":"user","content":"cache-demo"}],"temperature":0,"stream":true}'

curl -N http://localhost:8080/v1/chat/completions \
  -H "Authorization: Bearer dev-key" \
  -H "Content-Type: application/json" \
  -d '{"model":"local/ollama:qwen2.5:0.5b","messages":[{"role":"user","content":"cache-demo"}],"temperature":0,"stream":true}'
```

关注响应头：
- `X-Cache: hit|miss`
- `X-Upstream`

**TTFT/TPS 指标**

```bash
curl -sS http://localhost:8080/metrics | grep -E '^easyai_ttft_seconds|^easyai_tps' | head
```

**Guardrails（应 400）**

```bash
curl -i -sS http://localhost:8080/v1/chat/completions \
  -H "Authorization: Bearer dev-key" \
  -H "Content-Type: application/json" \
  -d '{"model":"local/ollama:qwen2.5:0.5b","messages":[{"role":"user","content":"call 10.0.0.1 now"}],"temperature":0}' | head
```

**Batch**

```bash
curl -sS -X POST http://localhost:8080/v1/batches \
  -H "Authorization: Bearer dev-key" \
  -H "Content-Type: application/json" \
  -d '{"requests":[{"endpoint":"/v1/chat/completions","body":{"model":"local/ollama:qwen2.5:0.5b","messages":[{"role":"user","content":"batch-1"}],"temperature":0}}]}'
```

## 2. 故障排查（Troubleshooting）

### 2.1 日志入口

```bash
docker compose logs --tail=200 oneapi
docker compose logs --tail=200 batch_worker
docker compose logs --tail=200 litellm
```

### 2.2 Redis/DB 快速定位

**缓存**
```bash
docker compose exec -T redis redis-cli --raw KEYS 'cache:v1:*' | head
docker compose exec -T redis redis-cli TTL 'cache:v1:<hash>'
docker compose exec -T redis redis-cli --raw GET 'cache:v1:<hash>' | head
```

**tenant 下发缓存**
```bash
docker compose exec -T redis redis-cli --raw GET 'tenantcfg:v1:t1'
```

**Batch 队列堆积**
```bash
docker compose exec -T redis redis-cli LLEN 'batch:q:v1'
```

### 2.3 常见问题与判断

- **401 Unauthorized（/v1/*）**
  - API key 模式：key 是否存在于 `ONEAPI_API_KEYS` 或数据库（Dashboard 创建）
  - OAuth 模式：`ONEAPI_OAUTH_JWKS_URL` 是否可达、issuer/audience 是否匹配
- **401 Unauthorized（/admin/api/* 写操作）**
  - 除 BasicAuth 外，写操作必须携带 `x-oneapi-admin-action: 1`
- **429 Rate limited**
  - 调整 `ONEAPI_RATE_LIMIT_RPM` 或在 Dashboard 调整 key/tenant 配额
  - tenant 绑定后按 tenant 聚合限流（同租户 key 共享）
- **503（/v1/batches）**
  - 未配置 `ONEAPI_INTERNAL_TOKEN`（Batch 未启用）
  - batch_worker 未运行或 token 不一致
- **缓存 hit 不出现**
  - `ONEAPI_CACHE_ENABLED=1`
  - 确定性请求（典型：`temperature=0`），且请求体一致
  - stream 缓存写入发生在完整 SSE 结束后（收到 `data: [DONE]`）
- **Redis 不可用**
  - 限流、缓存、tenantcfg 缓存与 batch 队列都会退化/不可用
