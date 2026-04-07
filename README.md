# EasyAI 平台 (LiteLLM + OneAPI Gateway)

本目录包含一个模块化的 AI API 服务平台，由以下部分组成：

- **LiteLLM 服务**: 一个独立的、轻量级的兼容 OpenAI 规范的 LLM 代理服务，适用于本地或远程模型后端。
- **OneAPI 网关**: 一个统一的网关，为上游 LLM 服务（包括本仓库中的 LiteLLM 服务）提供鉴权、限流、路由、数据转换、缓存以及使用量统计等功能。

## 快速启动 (组合模式, Docker)

1. 启动服务（将自动加载 `config/oneapi/oneapi.yaml` 中的配置）：

   ```bash
   docker compose up -d --build
   ```

2. 调用网关（请替换您的 API Key）：

   ```bash
   curl http://localhost:8080/v1/chat/completions \
     -H "Content-Type: application/json" \
     -H "Authorization: Bearer dev-key" \
     -d '{
      "model":"local/ollama:qwen2.5:0.5b",
       "messages":[{"role":"user","content":"Hello!"}],
       "temperature":0
     }'
   ```

## 提供的服务

- LiteLLM: `http://localhost:4000`
  - 健康检查: `/healthz`
  - 指标监控: `/metrics`
  - OpenAI 兼容接口: `/v1/*`
- OneAPI 网关: `http://localhost:8080`
  - 健康检查: `/healthz`
  - 指标监控: `/metrics`
  - API 文档 (Swagger UI): `/docs`
  - OpenAPI 规范: `/openapi.json`
  - 管理后台: `/dashboard`

## 项目文档

详情请参考：
- [docs/lite-mode-quickstart.md](docs/lite-mode-quickstart.md)（Lite 轻量模式：快速启动与排障指南）
- [docs/user-manual.md](docs/user-manual.md)（产品使用手册 + 常用 API 速查）
- [docs/deployment.md](docs/deployment.md)（部署：Combined 组合模式 / Lite 轻量模式 / K8S）
- [docs/operations.md](docs/operations.md)（运行手册：发布前检查 + 排障）
- [docs/development.md](docs/development.md)（开发/测试/安全基线/文档校验）
- [docs/architecture.md](docs/architecture.md)（架构与请求流）
