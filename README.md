# EasyAI 平台 (LiteLLM + OneAPI Gateway)

本目录包含一个模块化的 AI API 服务平台，由以下部分组成：

- **LiteLLM 服务**: 一个独立的、轻量级的兼容 OpenAI 规范的 LLM 代理服务，适用于本地或远程模型后端。
- **OneAPI 网关**: 一个统一的网关，为上游 LLM 服务（包括本仓库中的 LiteLLM 服务）提供鉴权、限流、路由、数据转换、缓存以及使用量统计等功能。
- **Batch Worker**: 异步批处理任务消费者，处理通过 API 提交的批量请求。
- **Chat UI**: 内置聊天界面，支持对话管理和流式输出。

## 快速启动 (组合模式, Docker)

1. 启动服务（将自动加载 `config/oneapi/oneapi.yaml` 中的配置）：

   ```bash
   docker compose up -d --build
   ```

2. 调用网关（请替换您的 API Key）：

   ```bash
   curl http://localhost:3003/v1/chat/completions \
     -H "Content-Type: application/json" \
     -H "Authorization: Bearer dev-key" \
     -d '{
      "model":"chat",
       "messages":[{"role":"user","content":"Hello!"}],
       "temperature":0
     }'
   ```

## 提供的服务

- LiteLLM: `http://localhost:4000`
  - 健康检查: `/healthz`
  - 指标监控: `/metrics`
  - OpenAI 兼容接口: `/v1/*`
- OneAPI 网关: `http://localhost:3003`
  - 健康检查: `/healthz`
  - 指标监控: `/metrics`
  - API 文档 (Swagger UI): `/docs`
  - OpenAPI 规范: `/openapi.json`
  - 管理后台: `/dashboard`
  - 内置聊天界面: `/chat`
- AnythingLLM: `http://localhost:3000`
  - 默认通过 OpenAI 兼容接口连接 EasyAI
  - 适合作为可选图形化聊天界面
- Batch Worker: 自动运行，消费 Redis 队列中的批处理任务
- Redis: `localhost:6379`（缓存、限流、队列）
- PostgreSQL: `localhost:5432`（用量统计、租户、Key 管理、对话存储）
- Ollama: `localhost:11434`（本地模型推理）

## 部署模式

本项目支持两种部署模式：

- **Combined 模式**（完整版）：包含 OneAPI 网关 + LiteLLM + 数据库组件 + Batch Worker，适合生产环境
- **Lite 模式**（轻量版）：仅 LiteLLM + Ollama，去除网关和数据库，适合个人开发测试

详情请参考部署文档。

## 项目文档

详情请参考：
- [docs/lite-mode-quickstart.md](docs/lite-mode-quickstart.md)（Lite 轻量模式：快速启动与排障指南）
- [docs/user-manual.md](docs/user-manual.md)（产品使用手册 + 常用 API 速查）
- [docs/deployment.md](docs/deployment.md)（部署：Combined 组合模式 / Lite 轻量模式 / K8S）
- [docs/operations.md](docs/operations.md)（运行手册：发布前检查 + 排障 + 一键清库）
- [docs/local-model-benchmark.md](docs/local-model-benchmark.md)（本机模型实测报告：内存占用、耗时与模型对比）
- [docs/development.md](docs/development.md)（开发/测试/安全基线/文档校验）
- [docs/architecture.md](docs/architecture.md)（架构与请求流）
