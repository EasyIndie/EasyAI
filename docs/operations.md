# 运行手册（Operations）

本文档聚合发布前检查与常见故障处理，减少分散文档带来的重复与偏差。

## 1. 发布前检查（Preflight）

### 1.1 关键环境变量（速查）

**OneAPI Gateway**
- `admin_user` / `admin_pass`：Dashboard 与 `/admin/api/*` 的 BasicAuth
- `auth_modes`：`apikey` / `oauth`
- `api_keys`：兼容模式静态 key（可选；也可在 Dashboard 创建 DB key）
- `upstreams`：上游列表（默认指向 litellm）
- `rate_limit_rpm`：默认 RPM
- `cache.enabled` / `cache.ttl_seconds`
- `cache.replay_mode: "fixed" | "original"` / `cache.replay_max_total_ms`
- Guardrails：`guardrails.*`
- Batch：`internal_token`（启用 batches 必配）
- `REDIS_URL` / `DATABASE_URL`

**Batch Worker**
- `batch_worker.oneapi_base_url`：worker 调用网关的内部地址（compose 默认 `http://oneapi:8080`）
- `internal_token`：必须与网关一致

### 1.2 启动与健康检查

```bash
docker compose up -d --build redis postgres litellm oneapi batch_worker
```

```bash
curl -sS http://localhost:8080/healthz
curl -sS http://localhost:8080/metrics | head
```

### 1.3 标准验收 SOP（推荐）

目标：把一次失败快速定位到 OneAPI / LiteLLM / Ollama 的哪一层，并覆盖 Trae 常用形态（非流式/流式、别名模型）。

#### Step A：就绪检查（避免误判）

1) 服务健康：

```bash
curl -sS http://localhost:8080/healthz
curl -sS http://localhost:4000/healthz
```

2) 接口文档可访问（用户侧）：

```bash
curl -sS http://localhost:8080/openapi.json | head
```

3) 确认本地模型已拉取（否则可能出现 upstream error）：

```bash
docker compose exec -T ollama ollama list
```

如未拉取，执行：

```bash
curl http://localhost:11434/api/pull -d '{"name":"qwen2.5:0.5b"}'
curl http://localhost:11434/api/pull -d '{"name":"qwen2.5-coder:1.5b"}'
```

3) 确认 LiteLLM 允许的模型列表包含目标模型：

```bash
curl -sS http://localhost:4000/v1/models | head
```

#### Step B：分层验证（定位责任方）

1) 直打 LiteLLM（排除 OneAPI 转发因素）：

```bash
curl -sS http://localhost:4000/v1/chat/completions \
  -H "Authorization: Bearer dev-key" \
  -H "Content-Type: application/json" \
  -d '{"model":"local/ollama:qwen2.5-coder:1.5b","messages":[{"role":"user","content":"Return only a TypeScript add(a,b) function."}],"temperature":0}' | head
```

2) 走 OneAPI（真实模型名）验证转发链路：

```bash
curl -sS http://localhost:8080/v1/chat/completions \
  -H "Authorization: Bearer dev-key" \
  -H "Content-Type: application/json" \
  -d '{"model":"local/ollama:qwen2.5-coder:1.5b","messages":[{"role":"user","content":"Same question, short answer."}],"temperature":0}' | head
```

3) 走 OneAPI（别名模型）验证 `model_map` 生效：

```bash
curl -sS http://localhost:8080/v1/chat/completions \
  -H "Authorization: Bearer dev-key" \
  -H "Content-Type: application/json" \
  -d '{"model":"coder","messages":[{"role":"user","content":"Write a TypeScript function to add two numbers."}],"temperature":0}' | head
```

#### Step C：形态覆盖（Trae 常用）

1) 非流式（stream:false 默认）已在 Step B 覆盖。

2) 流式（SSE）：

```bash
curl -N http://localhost:8080/v1/chat/completions \
  -H "Authorization: Bearer dev-key" \
  -H "Content-Type: application/json" \
  -d '{"model":"coder","messages":[{"role":"user","content":"Write a tiny TypeScript function."}],"temperature":0,"stream":true}'
```

3) 缓存验证（两次相同请求，关注 `X-Cache`）：

```bash
curl -N http://localhost:8080/v1/chat/completions \
  -H "Authorization: Bearer dev-key" \
  -H "Content-Type: application/json" \
  -d '{"model":"chat","messages":[{"role":"user","content":"cache-demo"}],"temperature":0,"stream":true}'

curl -N http://localhost:8080/v1/chat/completions \
  -H "Authorization: Bearer dev-key" \
  -H "Content-Type: application/json" \
  -d '{"model":"chat","messages":[{"role":"user","content":"cache-demo"}],"temperature":0,"stream":true}'
```

#### Step D：失败时的最短诊断动作

- 查看日志（按层定位）：

```bash
docker compose logs --tail=200 oneapi
docker compose logs --tail=200 litellm
docker compose logs --tail=200 ollama
```

- 常见现象与含义：
  - `model not allowed`：LiteLLM 的 `allowed_models` 不包含目标模型，或 OneAPI model map 未生效（别名未被重写）
  - `upstream error`：上游不可用、模型未拉取完成、资源不足或超时（优先看 litellm/ollama 日志）

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
  - API key 模式：key 是否存在于 `api_keys` 或数据库（Dashboard 创建）
  - OAuth 模式：`oauth.jwks_url` 是否可达、issuer/audience 是否匹配
- **401 Unauthorized（/admin/api/* 写操作）**
  - 除 BasicAuth 外，写操作必须携带 `x-oneapi-admin-action: 1`
- **429 Rate limited**
  - 调整 `rate_limit_rpm` 或在 Dashboard 调整 key/tenant 配额
  - tenant 绑定后按 tenant 聚合限流（同租户 key 共享）
- **503（/v1/batches）**
  - 未配置 `internal_token`（Batch 未启用）
  - batch_worker 未运行或 token 不一致
- **缓存 hit 不出现**
  - `cache.enabled: true`
  - 确定性请求（典型：`temperature=0`），且请求体一致
  - stream 缓存写入发生在完整 SSE 结束后（收到 `data: [DONE]`）
- **Redis 不可用**
  - 限流、缓存、tenantcfg 缓存与 batch 队列都会退化/不可用
