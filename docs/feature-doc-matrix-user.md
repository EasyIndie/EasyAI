# 功能-文档映射矩阵（对外版）

面向用户、接入方与运营同学：快速定位“这个能力怎么用、看哪份文档、如何验收”。

## 核心能力映射

| 功能域 | 你可以做什么 | 主要文档 | 快速验收 |
|---|---|---|---|
| OpenAI 兼容 API | 用统一 `/v1/*` 访问模型能力 | [user-manual.md](./user-manual.md) | `POST /v1/chat/completions` |
| 首页导航 | 集中进入聊天、管理后台、API 文档和 OpenAPI JSON | [user-manual.md](./user-manual.md) | 访问 `/` |
| 认证鉴权 | 使用 API Key 或 OAuth 调用接口 | [user-manual.md](./user-manual.md) | 用正确/错误凭据各调用一次 |
| 多租户与配额 | 给租户配置 RPM/TPM，禁用租户 | [user-manual.md](./user-manual.md) | Dashboard 或 `/admin/api/tenants` |
| 缓存与流式回放 | 对确定性请求启用缓存，流式命中回放 | [user-manual.md](./user-manual.md) | 相同请求调用两次看 `X-Cache` |
| 模型别名与回退 | 用别名模型调用，异常时自动回退 | [user-manual.md](./user-manual.md) | 看 `X-Model-Fallback` |
| 安全防护 | 拦截注入/内网访问意图，输出 PII 脱敏 | [user-manual.md](./user-manual.md) | 构造拦截请求应返回 400 |
| 批处理 | 提交批任务并异步查询结果 | [user-manual.md](./user-manual.md) | `POST /v1/batches` + 查询 output |
| 管理后台 | 管理 Key、租户、用量和 Playground | [user-manual.md](./user-manual.md) | 访问 `/dashboard` |
| 内置聊天 | 使用 `/chat` 与 `/chat-api/*` 进行会话交互 | [user-manual.md](./user-manual.md) | 访问 `/chat` 并发起一轮对话 |
| 监控与审计 | 查看 metrics 与用量统计 | [user-manual.md](./user-manual.md) | `GET /metrics` + Dashboard usage |

## 部署与排障入口

| 场景 | 文档 |
|---|---|
| Docker 部署 | [deployment.md](./deployment.md) |
| 发布前检查与故障排查 | [operations.md](./operations.md) |
