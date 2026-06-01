# 运行手册（Operations）

本文档聚合发布前检查与常见故障处理，减少分散文档带来的重复与偏差。

## 1. 发布前检查（Preflight）

### 1.1 关键配置项（速查）

**统一配置（在 `config/easyai.development.yaml` 中）**
- `app.env` / `app.port` / `app.log_level`
- `secrets.admin_password`：Dashboard 与 `/admin/api/*` 的管理密码，用户名默认 `admin`
- `secrets.api_keys`：客户端调用 `/v1/*` 使用的 API Key
- `secrets.internal_token`：Batch Worker 与网关之间的内部 token
- `secrets.postgres_password`：PostgreSQL 密码
- `providers`：上游供应商配置，例如 OpenAI、DeepSeek、Ollama
- `models`：对外暴露的模型名与真实供应商模型映射

### 1.2 启动与健康检查

```bash
docker compose up -d --build redis postgres litellm oneapi batch_worker
```

```bash
curl -sS http://localhost:3004/healthz
curl -sS http://localhost:3004/metrics | head
```

如果 `/metrics` 返回 403，说明当前来源 IP 不在服务默认内网白名单中。公网部署时建议让监控系统走内网地址。

### 1.2.1 发布前安全检查

```bash
grep -E 'REPLACE_WITH_|dev-key|dev-internal|postgres_password: "oneapi"' config/easyai.development.yaml
docker compose config | grep -E '5432:5432|6379:6379|4000:4000|11434:11434' && echo "unexpected exposed port"
```

预期：
- 第一条不应出现生产密钥仍为默认值。
- 第二条不应出现内部服务端口映射。

### 1.2.2 数据备份

```bash
./scripts/backup-postgres.sh
```

默认写入 `backups/postgres/`，可用 `BACKUP_DIR=/path/to/dir` 覆盖。恢复前请确认目标环境：

```bash
# 生产 override
COMPOSE_FILE="docker-compose.yml:docker-compose.local.yml" ./scripts/backup-postgres.sh
```

```bash
./scripts/restore-postgres.sh backups/postgres/oneapi_YYYYmmdd_HHMMSS.dump --yes
```

```bash
# 生产 override
COMPOSE_FILE="docker-compose.yml:docker-compose.local.yml" ./scripts/restore-postgres.sh backups/postgres/oneapi_YYYYmmdd_HHMMSS.dump --yes
```

### 1.3 一键 Smoke（推荐）

仓库提供了整链路 smoke 脚本（health/docs/auth/chat/dashboard/batch）：

```bash
./scripts/smoke-compose.sh
```

脚本默认从 `config/easyai.development.yaml` 读取 API Key 和后台账号；也可以临时覆盖连接参数：

```bash
BASE_URL=http://localhost:3004 ./scripts/smoke-compose.sh
```

### 1.3 标准验收 SOP（推荐）

目标：把一次失败快速定位到 OneAPI / LiteLLM / Ollama 的哪一层，并覆盖常用形态（非流式/流式、别名模型）。

#### Step A：就绪检查（避免误判）

1) 服务健康：

```bash
curl -sS http://localhost:3004/healthz
docker compose exec -T litellm python -c "import urllib.request; print(urllib.request.urlopen('http://localhost:4000/healthz').read().decode())"
```

2) 接口文档可访问（用户侧）：

```bash
curl -sS http://localhost:3004/openapi.json | head
```

3) 确认本地模型已拉取（否则可能出现 upstream error）：

```bash
docker compose exec -T ollama ollama list
```

如未拉取，执行：

```bash
docker compose exec -T ollama ollama pull qwen2.5:0.5b
docker compose exec -T ollama ollama pull qwen2.5-coder:1.5b
docker compose exec -T ollama ollama pull gemma4:e4b
docker compose exec -T ollama ollama pull gemma4:e2b
```

4) 确认 LiteLLM 允许的模型列表包含目标模型：

```bash
docker compose exec -T litellm python - <<'PY'
import urllib.request
print(urllib.request.urlopen('http://localhost:4000/v1/models').read().decode()[:1000])
PY
```

#### Step B：分层验证（定位责任方）

1) 直打 LiteLLM（排除 OneAPI 转发因素）：

```bash
docker compose exec -T litellm python - <<'PY'
import json, urllib.request
body = json.dumps({
  "model": "local/ollama:qwen2.5-coder:1.5b",
  "messages": [{"role": "user", "content": "Return only a TypeScript add(a,b) function."}],
  "temperature": 0
}).encode()
req = urllib.request.Request(
  "http://localhost:4000/v1/chat/completions",
  data=body,
  headers={"Content-Type": "application/json", "Authorization": "Bearer <api-key>"},
)
print(urllib.request.urlopen(req).read().decode()[:1000])
PY
```

2) 走 OneAPI（真实模型名）验证转发链路：

```bash
curl -sS http://localhost:3004/v1/chat/completions \
  -H "Authorization: Bearer <api-key>" \
  -H "Content-Type: application/json" \
  -d '{"model":"local/ollama:qwen2.5-coder:1.5b","messages":[{"role":"user","content":"Same question, short answer."}],"temperature":0}' | head
```

3) 走 OneAPI（统一模型名）验证配置生效：

```bash
curl -sS http://localhost:3004/v1/chat/completions \
  -H "Authorization: Bearer <api-key>" \
  -H "Content-Type: application/json" \
  -d '{"model":"coder","messages":[{"role":"user","content":"Write a TypeScript function to add two numbers."}],"temperature":0}' | head
```

#### Step C：形态覆盖（Trae 常用）

1) 非流式（stream:false 默认）已在 Step B 覆盖。

2) 流式（SSE）：

```bash
curl -N http://localhost:3004/v1/chat/completions \
  -H "Authorization: Bearer <api-key>" \
  -H "Content-Type: application/json" \
  -d '{"model":"coder","messages":[{"role":"user","content":"Write a tiny TypeScript function."}],"temperature":0,"stream":true}'
```

3) 缓存验证（两次相同请求，关注 `X-Cache`）：

```bash
curl -N http://localhost:3004/v1/chat/completions \
  -H "Authorization: Bearer <api-key>" \
  -H "Content-Type: application/json" \
  -d '{"model":"chat","messages":[{"role":"user","content":"cache-demo"}],"temperature":0,"stream":true}'

curl -N http://localhost:3004/v1/chat/completions \
  -H "Authorization: Bearer <api-key>" \
  -H "Content-Type: application/json" \
  -d '{"model":"chat","messages":[{"role":"user","content":"cache-demo"}],"temperature":0,"stream":true}'
```

关注响应头：
- `X-Cache: hit|miss`
- `X-Upstream`

4) 内置聊天界面（Chat UI）：

```bash
curl -sS http://localhost:3004/chat | head
```

#### Step D：失败时的最短诊断动作

- 查看日志（按层定位）：

```bash
docker compose logs --tail=200 oneapi
docker compose logs --tail=200 litellm
docker compose logs --tail=200 ollama
docker compose logs --tail=200 batch_worker
```

- 常见现象与含义：
  - `model not allowed` (400)：请求的模型名不在 `config/easyai.development.yaml` 的 `models` 中。
  - `Model not found` (404)：模型名称正确，但底层的 Ollama 未拉取该模型（执行 `ollama pull`）。
  - `Upstream connection error` (502)：Ollama 容器未启动或网络不通。
  - `Upstream timeout` (504)：模型加载或生成耗时过长，超出 `config/easyai.development.yaml` 中配置的超时时间。
  - `Insufficient memory` (507)：宿主机/容器可用内存不足以加载该模型（LiteLLM 捕获后会在后台尝试自愈清理）。
  - `Client Disconnected` (499)：客户端（如浏览器/curl）主动中断了请求，通常表现为流式生成意外停止。

**基础转发（非流式）**

```bash
curl -sS http://localhost:3004/v1/chat/completions \
  -H "Authorization: Bearer <api-key>" \
  -H "Content-Type: application/json" \
  -d '{"model":"local/ollama:qwen2.5:0.5b","messages":[{"role":"user","content":"hello"}],"temperature":0}'
```

**编程模型（轻量）**

```bash
curl -sS http://localhost:3004/v1/chat/completions \
  -H "Authorization: Bearer <api-key>" \
  -H "Content-Type: application/json" \
  -d '{"model":"local/ollama:qwen2.5-coder:1.5b","messages":[{"role":"user","content":"Write a TypeScript function to add two numbers."}],"temperature":0}'
```

**使用默认模型别名（推荐）**

```bash
curl -sS http://localhost:3004/v1/chat/completions \
  -H "Authorization: Bearer <api-key>" \
  -H "Content-Type: application/json" \
  -d '{"model":"coder","messages":[{"role":"user","content":"Write a TypeScript function to add two numbers."}],"temperature":0}'
```

**Streaming + 缓存命中（两次相同请求）**

```bash
curl -N http://localhost:3004/v1/chat/completions \
  -H "Authorization: Bearer <api-key>" \
  -H "Content-Type: application/json" \
  -d '{"model":"local/ollama:qwen2.5:0.5b","messages":[{"role":"user","content":"cache-demo"}],"temperature":0,"stream":true}'

curl -N http://localhost:3004/v1/chat/completions \
  -H "Authorization: Bearer <api-key>" \
  -H "Content-Type: application/json" \
  -d '{"model":"local/ollama:qwen2.5:0.5b","messages":[{"role":"user","content":"cache-demo"}],"temperature":0,"stream":true}'
```

关注响应头：
- `X-Cache: hit|miss`
- `X-Upstream`
- `X-Model-Fallback`（模型 fallback 时显示实际使用的模型）

**TTFT/TPS 指标**

```bash
curl -sS http://localhost:3004/metrics | grep -E '^easyai_ttft_seconds|^easyai_tps' | head
```

**Guardrails（应 400）**

```bash
curl -i -sS http://localhost:3004/v1/chat/completions \
  -H "Authorization: Bearer <api-key>" \
  -H "Content-Type: application/json" \
  -d '{"model":"local/ollama:qwen2.5:0.5b","messages":[{"role":"user","content":"call 10.0.0.1 now"}],"temperature":0}' | head
```

**Batch**

```bash
curl -sS -X POST http://localhost:3004/v1/batches \
  -H "Authorization: Bearer <api-key>" \
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
  - API key 模式：key 是否存在于 `secrets.api_keys` 或数据库（Dashboard 创建）
- **401 Unauthorized（/admin/api/* 写操作）**
  - 除 BasicAuth 外，写操作必须携带 `x-oneapi-admin-action: 1`
- **429 Rate limited**
  - 在 Dashboard 调整 key/tenant 配额
  - tenant 绑定后按 tenant 聚合限流（同租户 key 共享）
  - 租户 TPM（每分钟 token 数）超限也会返回 429
- **503（/v1/batches）**
  - 未配置 `secrets.internal_token`（Batch 未启用）
  - batch_worker 未运行或 token 不一致
- **缓存 hit 不出现**
  - 请求是否为确定性请求，例如 `temperature: 0`
  - 确定性请求（典型：`temperature=0`），且请求体一致
  - stream 缓存写入发生在完整 SSE 结束后（收到 `data: [DONE]`）
- **Redis 不可用**
  - 限流、缓存、tenantcfg 缓存与 batch 队列都会退化/不可用

## 3. 数据清理与重置

项目已提供一键清库脚本：[reset-db.sh](../scripts/reset-db.sh)

### 3.1 脚本用途

- 作用于当前项目的 `docker-compose.yml`
- 清理 Postgres 中的 OneAPI 业务数据
- 可选同时清理 Redis 缓存和限流计数
- 不会删除 Ollama 模型卷，不会删除源码或 YAML 配置

### 3.2 常用命令

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

跳过确认提示：

```bash
./scripts/reset-db.sh --all --with-redis --yes
```

查看脚本帮助：

```bash
./scripts/reset-db.sh --help
```

停止并删除当前项目容器（保留数据库卷与 Ollama 模型卷）：

```bash
docker compose down
```

停止容器并删除 Postgres 数据卷，下次启动后数据库会重新初始化：

```bash
docker compose down && docker volume rm easyai_dev_postgres_data
```

停止容器、删除 Postgres 数据卷并重新构建启动服务：

```bash
docker compose down && docker volume rm easyai_dev_postgres_data && docker compose up -d --build
```

### 3.3 默认清空范围

- `batch_items`
- `batches`
- `usage_events`
- `api_keys`
- `tenants`

### 3.4 执行行为

脚本会自动执行以下步骤：

1. 停止 `oneapi` 和 `batch_worker`
2. 清空 Postgres 中目标表
3. 按需清空 Redis
4. 重新启动 `oneapi` 和 `batch_worker`

如果您只想让 Dashboard 用量归零，而保留租户和 API Key，请使用 `--usage-only`。

如需直接清理 Docker 容器，请优先使用上面的精确命令，不要直接执行 `docker compose down -v`，否则会连同 `easyai_dev_ollama_data` 模型卷一起删除，已拉取的本地模型也会丢失。
