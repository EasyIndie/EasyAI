# EasyAI

[![CI](https://github.com/EasyIndie/EasyAI/actions/workflows/ci.yml/badge.svg)](https://github.com/EasyIndie/EasyAI/actions/workflows/ci.yml)

EasyAI 是一个可本地运行、免费自部署的统一 LLM 接入层：一份 YAML 配置，屏蔽不同厂商的协议差异。
- OneAPI Gateway（统一 `/v1/*` 入口、鉴权、限流、Chat/Batch API、首页与会话页）
- LiteLLM Proxy（官方镜像，模型接入面：provider 适配、别名、重试/故障转移、缓存、护栏、密钥/预算/用量控制台）
- Batch Worker（异步批处理消费）
- 控制台（LiteLLM Admin UI，支持中文）+ 自研 Chat UI
- 镜像默认 `ghcr.io/berriai/litellm:main-latest`；可用 `LITELLM_IMAGE` 环境变量固定版本

## 快速启动（开发环境）

```bash
docker compose up -d --build
curl -sS http://localhost:3004/healthz
docker compose exec -T ollama ollama pull qwen2.5:0.5b
open http://localhost:3004/        # 首页：聊天 + 入口导航
open http://localhost:3005/ui      # 控制台：密钥 / 预算 / 用量（中文可切换）
```

发起一次请求（默认开发 key: `dev-key`）：

```bash
curl -sS http://localhost:3004/v1/chat/completions \
  -H "Authorization: Bearer dev-key" \
  -H "Content-Type: application/json" \
  -d '{"model":"chat","messages":[{"role":"user","content":"hello"}],"temperature":0}'
```

## 生产环境部署（本地私有配置）

```bash
cp config/easyai.production.example.yaml config/easyai.production.local.yaml
# 编辑并替换所有 REPLACE_WITH_*
python3 scripts/render-local-compose.py config/easyai.production.local.yaml > docker-compose.local.yml
docker compose -f docker-compose.yml -f docker-compose.local.yml up -d --build
docker compose -f docker-compose.yml -f docker-compose.local.yml exec -T ollama ollama pull qwen2.5:0.5b
```

生产环境对外服务验收（smoke）：

```bash
BASE_URL=http://localhost:3003 CONFIG_FILE=config/easyai.production.local.yaml ./scripts/smoke-compose.sh
```

## 主要入口

- 开发网关：`http://localhost:3004`
- 生产网关（override）：`http://localhost:3003`
- 首页：`/`
- API 文档：`/docs`
- OpenAPI JSON：`/openapi.json`
- 控制台（LiteLLM Admin UI，右上角可切换中文）：`http://localhost:3005/ui`，用户名 `admin`，密码为 `secrets.master_key`
- Chat：`/chat`
- `/dashboard` 会 302 到控制台

## 文档导航

- [用户手册](docs/user-manual.md)
- [部署指南](docs/deployment.md)
- [运行手册](docs/operations.md)
- [开发与测试](docs/development.md)
- [前端 UI 约定](docs/frontend-ui.md)
- [架构说明](docs/architecture.md)
- [YAML 密钥管理](docs/yaml-secret-management.md)
