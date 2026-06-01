# EasyAI 平台 (LiteLLM + OneAPI Gateway)

本目录包含一个模块化的 AI API 服务平台，由以下部分组成：

- **LiteLLM 服务**: 一个独立的、轻量级的兼容 OpenAI 规范的 LLM 代理服务，适用于本地或远程模型后端。
- **OneAPI 网关**: 一个统一的网关，为上游 LLM 服务（包括本仓库中的 LiteLLM 服务）提供鉴权、限流、路由、数据转换、缓存以及使用量统计等功能。
- **Batch Worker**: 异步批处理任务消费者，处理通过 API 提交的批量请求。
- **Chat UI**: 内置聊天界面，支持对话管理和流式输出。

## 快速启动 (完整模式, Docker)

1. 启动服务（默认加载 [config/easyai.development.yaml](config/easyai.development.yaml)，不包含生产密钥）：

   ```bash
   docker compose up -d --build
   ```

2. 调用网关（请使用 `config/easyai.development.yaml` 中 `secrets.api_keys` 配置的 Key）：

   ```bash
   curl http://localhost:3004/v1/chat/completions \
     -H "Content-Type: application/json" \
     -H "Authorization: Bearer <api-key>" \
     -d '{
      "model":"chat",
       "messages":[{"role":"user","content":"Hello!"}],
       "temperature":0
     }'
   ```

默认开发栈使用 Compose project `easyai-dev`、数据卷 `easyai_dev_*`、宿主机端口 `3004`。生产或团队部署时，不要把真实密钥写入入仓配置。复制一个本地 YAML，渲染 Compose override 后启动：

```bash
cp config/easyai.production.example.yaml config/easyai.production.local.yaml
# 编辑 config/easyai.production.local.yaml，替换 REPLACE_WITH_* 后再生成 override
python3 scripts/render-local-compose.py config/easyai.production.local.yaml > docker-compose.local.yml
```

```bash
docker compose -f docker-compose.yml -f docker-compose.local.yml up -d --build
```

生产栈使用 Compose project `easyai-prod`、数据卷 `easyai_prod_*`、宿主机端口 `3003`，与开发栈隔离。

详见 [docs/yaml-secret-management.md](docs/yaml-secret-management.md)。

## 提供的服务

- OneAPI 网关（开发）: `http://localhost:3004`
- OneAPI 网关（生产 override）: `http://localhost:3003`
  - 首页导航: `/`
  - 健康检查: `/healthz`
  - 指标监控: `/metrics`
  - API 文档 (Swagger UI): `/docs`
  - OpenAPI 规范: `/openapi.json`
  - 管理后台: `/dashboard`
  - 内置聊天界面: `/chat`
- LiteLLM: Docker 内网服务 `http://litellm:4000`，不默认发布到宿主机
- Batch Worker: 自动运行，消费 Redis 队列中的批处理任务
- Redis: Docker 内网服务 `redis:6379`（缓存、限流、队列）
- PostgreSQL: Docker 内网服务 `postgres:5432`（用量统计、租户、Key 管理、对话存储）
- Ollama: Docker 内网服务 `ollama:11434`（本地模型推理）

## 部署模式

本项目仅保留完整模式：包含 OneAPI 网关 + LiteLLM + 数据库组件 + Batch Worker + Ollama。开发使用根目录的 `docker-compose.yml`，生产使用 `docker-compose.yml + docker-compose.local.yml`。

详情请参考部署文档。

## 项目文档

详情请参考：
- [docs/user-manual.md](docs/user-manual.md)（产品使用手册 + 常用 API 速查）
- [docs/deployment.md](docs/deployment.md)（部署：完整模式 / K8S）
- [docs/operations.md](docs/operations.md)（运行手册：发布前检查 + 排障 + 一键清库）
- [docs/yaml-secret-management.md](docs/yaml-secret-management.md)（YAML 配置与敏感信息管理）
- [docs/local-model-benchmark.md](docs/local-model-benchmark.md)（本机模型实测报告：内存占用、耗时与模型对比）
- [docs/development.md](docs/development.md)（开发/测试/安全基线/文档校验）
- [docs/architecture.md](docs/architecture.md)（架构与请求流）
- [docs/feature-doc-matrix-user.md](docs/feature-doc-matrix-user.md)（功能-文档映射矩阵：对外版）
- [docs/feature-doc-matrix-maintainer.md](docs/feature-doc-matrix-maintainer.md)（功能-文档映射矩阵：对内版）
