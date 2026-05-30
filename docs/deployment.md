# 部署指南（Deployment）

本文档汇总本仓库支持的部署方式：完整模式（OneAPI 网关 + LiteLLM + 数据库组件 + Batch Worker + Ollama）。

## 1. 完整模式

此模式适合在生产环境中提供完整的 API 管理、鉴权、限流、审计、缓存以及异步任务（Batch）功能。

### 1.1 Docker Compose

首次对外提供服务前，请直接检查并替换 YAML 中的敏感值：
- [config/oneapi/oneapi.yaml](../config/oneapi/oneapi.yaml)：`security.admin.password`、`security.api_keys`、`internal.token`、`database.password`
- [docker-compose.yml](../docker-compose.yml)：`POSTGRES_PASSWORD`

在仓库根目录直接运行：

```bash
docker compose up -d --build
```

如果已有旧版本 `postgres_data` 数据卷，PostgreSQL 主版本升级后不能直接复用旧数据目录；请先做数据库备份和迁移，或在开发环境中清理旧卷后重新初始化。

验证网关与代理层是否正常启动：

```bash
curl -sS http://localhost:3003/healthz
docker compose exec -T litellm python -c "import urllib.request; print(urllib.request.urlopen('http://localhost:4000/healthz').read().decode())"
```

生产暴露面：
- Compose 默认只向宿主机发布 OneAPI 网关端口 `3003`。
- `postgres`、`redis`、`litellm`、`ollama` 只在 Docker 内网访问，不再映射宿主机端口。
- 本次部署暂未包含 TLS 和反向代理；公网开放时请只放通 OneAPI 端口，并在前置网络层限制管理端来源。

管理后台：
- 首页导航：`http://localhost:3003/`
- Dashboard：`http://localhost:3003/dashboard`
- 内置聊天界面：`http://localhost:3003/chat`
- Swagger API 文档：`http://localhost:3003/docs`

通过网关发起一次测试请求：

```bash
curl -sS http://localhost:3003/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <api-key>" \
  -d '{
    "model":"chat",
    "messages":[{"role":"user","content":"Say hello in one sentence."}],
    "temperature":0
  }'
```

### 1.2 Batch 异步任务服务

- 默认在完整模式中已启用：`config/oneapi/oneapi.yaml` 包含 `internal.token` 且 compose 会自动启动 `batch_worker` 容器。
- 若需关闭 Batch 功能：清空 YAML 配置中的 `internal.token`，并在 compose 中移除/停止 `batch_worker`。未配置 token 时访问 `/v1/batches` 会返回 503 错误。

---

## 2. 配置文件入口

系统的主要行为通过以下 YAML 文件集中控制，不依赖 `.env` 或运行时环境变量注入：

- **OneAPI 网关配置**：[config/oneapi/oneapi.yaml](../config/oneapi/oneapi.yaml)
- **LiteLLM 代理配置**：[config/litellm/litellm.yaml](../config/litellm/litellm.yaml)

### 2.1 生产安全开关

- `server.env: production` 时会拒绝默认管理密码、`dev-key`、`dev-internal` 和默认数据库密码。
- `security.admin.allowed_cidrs` 控制 Dashboard 和 `/admin/api/*` 的来源 IP。
- `security.metrics_allowed_cidrs` 控制 `/metrics` 的来源 IP。
- `server.body_limit` 控制请求体上限，默认 `10mb`。
- `security.security_headers: true` 会开启基础安全响应头。
- 默认仅启用 API Key；如需 OAuth，请在 `security.auth_modes` 中打开 `oauth` 并配置 `security.oauth.jwks_url`、`audience`、`issuer`。

### 2.2 备份恢复

备份：

```bash
./scripts/backup-postgres.sh
```

恢复：

```bash
./scripts/restore-postgres.sh backups/postgres/oneapi_YYYYmmdd_HHMMSS.dump --yes
```
