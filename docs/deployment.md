# 部署指南（Deployment）

本文档汇总本仓库支持的部署方式：完整模式（OneAPI 网关 + LiteLLM + 数据库组件 + Batch Worker + Ollama）。

## 1. 完整模式

此模式适合在生产环境中提供完整的 API 管理、鉴权、限流、审计、缓存以及异步任务（Batch）功能。

### 1.1 Docker Compose

开发启动直接使用入仓的 [config/easyai.yaml](../config/easyai.yaml)，Compose project 为 `easyai-dev`，数据卷为 `easyai_dev_*`，宿主机端口为 `3004`。生产或团队部署时，先创建本地配置并生成 Compose override：

```bash
cp config/easyai.local.example.yaml config/easyai.local.yaml
# 编辑 config/easyai.local.yaml，替换 REPLACE_WITH_* 后再生成 override
python3 scripts/render-local-compose.py config/easyai.local.yaml > docker-compose.local.yml
```

然后运行：

```bash
docker compose -f docker-compose.yml -f docker-compose.local.yml up -d --build
```

生产 override 使用 Compose project `easyai-prod`，数据卷为 `easyai_prod_*`，宿主机端口为 `3003`。开发和生产可以在同一台机器上共存，不共享容器、网络或数据卷。

开发环境可直接运行：

```bash
docker compose up -d --build
```

如果已有旧版本 `postgres_data` 数据卷，PostgreSQL 主版本升级后不能直接复用旧数据目录；请先做数据库备份和迁移，或在开发环境中清理旧卷后重新初始化。

验证网关与代理层是否正常启动：

```bash
curl -sS http://localhost:3004/healthz   # 开发
curl -sS http://localhost:3003/healthz   # 生产 override
docker compose exec -T litellm python -c "import urllib.request; print(urllib.request.urlopen('http://localhost:4000/healthz').read().decode())"
```

生产暴露面：
- Compose 默认只向宿主机发布 OneAPI 网关端口 `3003`。
- `postgres`、`redis`、`litellm`、`ollama` 只在 Docker 内网访问，不再映射宿主机端口。
- 本次部署暂未包含 TLS 和反向代理；公网开放时请只放通 OneAPI 端口，并在前置网络层限制管理端来源。

管理后台：
- 开发首页导航：`http://localhost:3004/`
- 生产首页导航：`http://localhost:3003/`
- Dashboard：`/dashboard`
- 内置聊天界面：`/chat`
- Swagger API 文档：`/docs`

通过网关发起一次测试请求：

```bash
curl -sS http://localhost:3004/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <api-key>" \
  -d '{
    "model":"chat",
    "messages":[{"role":"user","content":"Say hello in one sentence."}],
    "temperature":0
  }'
```

### 1.2 Batch 异步任务服务

- 默认在完整模式中已启用：`config/easyai.yaml` 包含 `secrets.internal_token` 且 compose 会自动启动 `batch_worker` 容器。
- 若需关闭 Batch 功能：清空 YAML 配置中的 `secrets.internal_token`，并在 compose 中移除/停止 `batch_worker`。未配置 token 时访问 `/v1/batches` 会返回 503 错误。

---

## 2. 配置文件入口

系统的主要行为通过一个 YAML 文件集中控制，不依赖 `.env` 或运行时环境变量注入：

- **统一配置**：[config/easyai.yaml](../config/easyai.yaml)

### 2.1 生产安全开关

- `app.env: production` 时会拒绝默认管理密码、`dev-key`、`dev-internal` 和默认数据库密码。
- `secrets.admin_password`、`secrets.api_keys`、`secrets.internal_token`、`secrets.postgres_password` 是生产部署必须替换的敏感值。
- `models` 下的键就是客户端请求时使用的模型名。
- `providers` 配置 OpenAI、DeepSeek、Ollama 等上游凭据和地址。

### 2.2 备份恢复

备份：

```bash
./scripts/backup-postgres.sh
```

生产 override 备份请显式指定 Compose 文件，避免误备份开发库：

```bash
COMPOSE_FILE="docker-compose.yml:docker-compose.local.yml" ./scripts/backup-postgres.sh
```

恢复：

```bash
./scripts/restore-postgres.sh backups/postgres/oneapi_YYYYmmdd_HHMMSS.dump --yes
```

生产 override 恢复同样需要显式指定：

```bash
COMPOSE_FILE="docker-compose.yml:docker-compose.local.yml" ./scripts/restore-postgres.sh backups/postgres/oneapi_YYYYmmdd_HHMMSS.dump --yes
```
