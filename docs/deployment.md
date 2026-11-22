# 部署与运维

EasyAI 只有一份 YAML 配置和一组容器：`oneapi`（网关）+ `litellm`（模型接入面）+ `postgres` + `redis` + `batch_worker` + `ollama`，可选 `openwebui`（聊天界面）。

---

## 1. 开发环境（一条命令）

```bash
docker compose up -d --build
docker compose exec -T ollama ollama pull qwen2.5:0.5b
```

可选：想要开箱即用的中文聊天界面

```bash
docker compose --profile chat up -d
```

健康检查：

```bash
curl -sS http://localhost:3004/healthz
curl -sS http://localhost:3004/v1/models -H "Authorization: Bearer dev-key"
```

发起请求：

```bash
curl -sS http://localhost:3004/v1/chat/completions \
  -H "Authorization: Bearer dev-key" \
  -H "Content-Type: application/json" \
  -d '{"model":"chat","messages":[{"role":"user","content":"hello"}],"temperature":0}'
```

## 2. 生产环境（本地私有配置）

```bash
cp config/easyai.production.example.yaml config/easyai.production.local.yaml
# 编辑并替换所有 REPLACE_WITH_*
python3 scripts/render-local-compose.py config/easyai.production.local.yaml > docker-compose.local.yml
docker compose -f docker-compose.yml -f docker-compose.local.yml up -d --build
docker compose -f docker-compose.yml -f docker-compose.local.yml exec -T ollama ollama pull qwen2.5:0.5b
```

验收：

```bash
BASE_URL=http://localhost:3003 CONFIG_FILE=config/easyai.production.local.yaml ./scripts/smoke-compose.sh
```

生产 override 使用 Compose project `easyai-prod`、数据卷 `easyai_prod_*`，与开发环境互不影响。

## 3. 端口与入口

| 端口 | 用途 | 暴露范围 |
|---|---|---|
| `3004` / `3003` | 网关（开发 / 生产）：`/v1/*`、`/docs`、`/healthz` | 对外 |
| `3005` | 控制台（LiteLLM Admin UI） | 默认只监听 `127.0.0.1` |
| `3006` | 聊天界面（Open WebUI，`--profile chat`） | 对外 |
| — | `postgres`、`redis`、`ollama` | 仅容器内网 |

页面入口：`/` 首页、`/ui` 控制台、`/chat` 聊天、`/docs` API 文档、`/healthz` 健康检查、`/metrics` 指标（透传 LiteLLM）。

## 4. 控制台与中文界面

控制台就是 LiteLLM 自带的 Admin UI：

- 地址：`http://localhost:3005/ui`（网关 `/ui`、`/dashboard` 会 302 过来）
- 用户名：`admin`；密码：`secrets.master_key`
- 登录后在账户菜单把语言切换为「简体中文」（`zh-CN` 语言包内置，默认英文，选择存在浏览器）
- 密钥、预算、RPM/TPM、模型白名单、用量与请求日志都在这里管理

镜像版本：

- 默认 `LITELLM_IMAGE=ghcr.io/berriai/litellm:main-latest`（含中文语言包）
- 保守选择：`ghcr.io/berriai/litellm:main-stable`（当前稳定版无 `zh-CN`，界面为英文），或固定到验证过的镜像 digest
- 升级流程：改 `LITELLM_IMAGE` → `docker compose up -d litellm` → 跑一遍 `./scripts/smoke-compose.sh`

## 5. 配置说明

统一配置源是 `config/easyai.yaml`（容器内路径），开发/生产各挂各的文件。启动时 `scripts/render-litellm-config.py` 会把它翻译成 LiteLLM 配置，因此**不需要第二份配置文件**。

| 段 | 内容 |
|---|---|
| `app` | `port`、`log_level`、`console_url`、`chat_url`、`rate_limit_rpm`、`timeout_ms`、`cache_enabled`、`cache_ttl_seconds`、`num_retries` |
| `secrets` | `master_key`（控制台密码 + 内部主密钥）、`salt_key`（加密控制台保存的厂商 key）、`api_keys`、`internal_token`、`postgres_password` |
| `providers` | 各厂商 `api_base` / `api_key` / `api_version` |
| `models` | 对外模型别名 → `provider` + `model`，可加 `fallback: [其他别名]` |
| `guardrails` | 可选：`blocked_keywords`、`mask_pii`（交给 LiteLLM 内置内容过滤） |

`app.timeout_ms` 是模型请求超时；网关在转发时会多等 5 秒，避免网关先于 LiteLLM 超时。

生产安全开关：

- `app.env: production` 时，占位值（`dev-key`、`dev-internal`、`REPLACE_WITH_*`）会让网关直接启动失败
- `secrets.salt_key` 一旦使用就不要再改，否则控制台里保存的厂商凭据会失效

Batch：

- 默认启用（`secrets.internal_token` 存在 + `batch_worker` 运行）
- 想关闭：清空 `secrets.internal_token`，停掉 `batch_worker`；此时 `/v1/batches` 返回 503

## 6. 备份、恢复与重置

```bash
./scripts/backup-postgres.sh
./scripts/restore-postgres.sh backups/postgres/oneapi_YYYYmmdd_HHMMSS.dump --yes
./scripts/reset-db.sh --with-redis --yes
```

生产 override 需要显式指定 Compose 文件：

```bash
COMPOSE_FILE="docker-compose.yml:docker-compose.local.yml" ./scripts/backup-postgres.sh
COMPOSE_FILE="docker-compose.yml:docker-compose.local.yml" ./scripts/restore-postgres.sh backups/postgres/oneapi_YYYYmmdd_HHMMSS.dump --yes
```

停止服务（保留数据）：

```bash
docker compose down
docker compose -f docker-compose.yml -f docker-compose.local.yml down
```

不要用 `docker compose down -v`，会删除模型卷和数据卷。

## 7. 故障排查

```bash
docker compose logs --tail=200 oneapi litellm batch_worker
curl -sS http://localhost:3004/healthz
curl -sS http://localhost:3005/health/liveliness
```

| 现象 | 定位 |
|---|---|
| `401 unauthorized` | API Key 错误；虚拟密钥请在控制台确认状态/预算 |
| `429 rate limited` | 网关 `app.rate_limit_rpm` 或虚拟密钥的 RPM/预算 |
| `502 / 504` | LiteLLM 不可达或上游超时，看 `litellm` 日志 |
| 模型不存在 | `models` 里没有该别名，或 Ollama 未 `ollama pull` |
| Batch 503 | `secrets.internal_token` 未配置或 worker 未运行 |
| 控制台打不开 | 端口映射为 `127.0.0.1:3005`，只能从本机访问 |
| 控制台登录失败 | 用户名 `admin`，密码是 `secrets.master_key` |

Redis 队列/缓存探查：

```bash
docker compose exec -T redis redis-cli LLEN 'batch:q:v1'
```
