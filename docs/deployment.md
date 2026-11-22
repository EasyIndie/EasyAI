# 部署指南（Deployment）

本文档汇总本仓库支持的部署方式：完整模式（EasyAI 网关 + LiteLLM Proxy + 数据库组件 + Batch Worker + Ollama）。

## 1. 完整模式

此模式适合在生产环境中提供统一的模型接入、密钥与预算治理、限流、用量审计、响应缓存以及异步任务（Batch）功能。

### 1.1 开发环境部署步骤（Docker Compose）

开发环境直接使用入仓配置 [config/easyai.development.yaml](../config/easyai.development.yaml)，Compose project 为 `easyai-dev`，数据卷为 `easyai_dev_*`，宿主机端口为 `3004`。

步骤 1：启动

```bash
docker compose up -d --build
```

步骤 2：健康检查

```bash
curl -sS http://localhost:3004/healthz
curl -sS http://localhost:3004/v1/models -H "Authorization: Bearer dev-key"
```

步骤 2.5：准备本地 Ollama 模型（仅当 `models.chat` 指向 Ollama）

```bash
docker compose exec -T ollama ollama pull qwen2.5:0.5b
```

步骤 3：接口验证（网关转发）

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

步骤 4：查看服务状态与日志（可选）

```bash
docker compose ps
docker compose logs --tail=200 oneapi litellm batch_worker
```

### 1.2 生产环境部署步骤（Docker Compose + 本地私有配置）

步骤 1：准备生产私有配置并渲染 override（不要把真实密钥写入入仓文件）

```bash
cp config/easyai.production.example.yaml config/easyai.production.local.yaml
# 编辑 config/easyai.production.local.yaml，替换全部 REPLACE_WITH_*
python3 scripts/render-local-compose.py config/easyai.production.local.yaml > docker-compose.local.yml
```

步骤 2：启动生产栈（使用 override）

```bash
docker compose -f docker-compose.yml -f docker-compose.local.yml up -d --build
```

步骤 3：健康检查

```bash
curl -sS http://localhost:3003/healthz
curl -sS http://localhost:3003/v1/models -H "Authorization: Bearer $API_KEY"
```

步骤 3.5：准备生产 Ollama 模型（仅当 `models.chat` 指向 Ollama）

```bash
docker compose -f docker-compose.yml -f docker-compose.local.yml exec -T ollama \
  ollama pull qwen2.5:0.5b
```

步骤 4：接口验证（网关转发）

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

步骤 5：查看服务状态与日志（可选）

```bash
docker compose -f docker-compose.yml -f docker-compose.local.yml ps
docker compose -f docker-compose.yml -f docker-compose.local.yml logs --tail=200 oneapi litellm batch_worker
```

步骤 6：对外服务验收（建议）

```bash
BASE_URL=http://localhost:3003 CONFIG_FILE=config/easyai.production.local.yaml ./scripts/smoke-compose.sh
```

生产 override 使用 Compose project `easyai-prod`，数据卷为 `easyai_prod_*`，宿主机端口为 `3003`。开发与生产可在同机共存，不共享容器、网络和数据卷。

### 1.3 端口暴露与访问入口

暴露面：

- 网关端口：开发 `3004`，生产 `3003`。
- 控制台端口：`127.0.0.1:3005`（只监听本机，LiteLLM Admin UI + 管理 API）。需要远程访问时请自行加反向代理和访问控制。
- `postgres`、`redis`、`ollama` 只在 Docker 内网访问。
- 本次部署暂未包含 TLS；公网开放时请只放通网关端口，并在前置网络层限制管理端来源。

### 1.3.1 控制台与中文界面

控制台就是 LiteLLM 自带的 Admin UI：

- 地址：`http://localhost:3005/ui`（网关 `/ui`、`/dashboard` 会 302 过来）
- 用户名：`admin`
- 密码：`secrets.master_key`
- 登录后右上角账户菜单或设置里把语言切换为「简体中文」（`zh-CN` 语言包已内置，默认英文，选择会保存在浏览器本地）

镜像版本：

- 默认 `LITELLM_IMAGE=ghcr.io/berriai/litellm:main-latest`，包含中文语言包。
- 想更保守可以改成 `ghcr.io/berriai/litellm:main-stable`（当前稳定版尚未包含 `zh-CN` 语言包，界面为英文），或固定到已验证的镜像 digest。

管理入口：
- 开发首页：`http://localhost:3004/`
- 生产首页：`http://localhost:3003/`
- 控制台（中文可切换）：`http://localhost:3005/ui`
- 内置聊天界面：`/chat`
- Swagger API 文档：`/docs`

### 1.4 停止与重启

开发环境停止：

```bash
docker compose down
```

生产环境停止（保留数据卷）：

```bash
docker compose -f docker-compose.yml -f docker-compose.local.yml down
```

如果已有旧版本 `postgres_data` 数据卷，PostgreSQL 主版本升级后不能直接复用旧数据目录；请先做数据库备份和迁移，或在开发环境中清理旧卷后重新初始化。

### 1.5 Batch 异步任务服务

- 默认在完整模式中已启用：`config/easyai.development.yaml` 包含 `secrets.internal_token` 且 compose 会自动启动 `batch_worker` 容器。
- 若需关闭 Batch 功能：清空 YAML 配置中的 `secrets.internal_token`，并在 compose 中移除/停止 `batch_worker`。未配置 token 时访问 `/v1/batches` 会返回 503 错误。

---

## 2. 配置文件入口

系统的主要行为通过一个 YAML 文件集中控制，不依赖 `.env` 或运行时环境变量注入。开发环境使用入仓配置，生产环境使用本地私有配置并通过 Compose override 挂载到容器内同一路径：

- **开发配置**：[config/easyai.development.yaml](../config/easyai.development.yaml)
- **生产配置示例**：[config/easyai.production.example.yaml](../config/easyai.production.example.yaml)
- **生产本地配置**：`config/easyai.production.local.yaml`（不入仓）

### 2.1 生产安全开关

- `app.env: production` 时会拒绝默认管理密码、`dev-key`、`dev-internal` 和默认数据库密码。
- `secrets.master_key`、`secrets.salt_key`、`secrets.api_keys`、`secrets.internal_token`、`secrets.postgres_password` 是生产部署必须替换的敏感值。
- `secrets.master_key` 同时是控制台登录密码和网关访问 LiteLLM 的内部主密钥，不要发给 API 客户端。
- `secrets.salt_key` 用于加密控制台里保存的厂商密钥，一旦使用就不要修改，否则已保存的凭据会失效。
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
