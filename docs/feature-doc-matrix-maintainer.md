# 功能-文档映射矩阵（对内版）

面向维护者：用于确认“能力实现位置、配置入口、测试与门禁、文档同步责任”。

## 1. 功能实现映射

| 功能域 | 当前实现能力 | 主文档（产品/API） | 次文档（架构/运维/部署） | 验收与门禁 |
|---|---|---|---|---|
| 网关入口 | `/v1/*` 统一入口、转发、模型重写 | [user-manual.md](./user-manual.md) | [architecture.md](./architecture.md), [deployment.md](./deployment.md) | `scripts/smoke-compose.sh` |
| 首页导航 | `/` 集中导航到 Chat、Dashboard、Docs；OpenAPI JSON 从 `/docs` 突出进入 | [user-manual.md](./user-manual.md) | [deployment.md](./deployment.md) | curl `/` + `/docs` |
| 认证 | API Key、internal token | [user-manual.md](./user-manual.md) | [architecture.md](./architecture.md), [development.md](./development.md) | `oneapi-gateway/test/auth.test.ts` |
| 多租户治理 | tenant 绑定、tenant 配额、tenant 禁用 | [user-manual.md](./user-manual.md) | [operations.md](./operations.md) | `oneapi-gateway/test/admin.api.test.ts` |
| 限流配额 | RPM（主体/租户）、TPM（租户） | [user-manual.md](./user-manual.md) | [architecture.md](./architecture.md), [operations.md](./operations.md) | `oneapi-gateway/test/rate_limit.test.ts` |
| 缓存回放 | Redis 缓存、SSE 回放 fixed/original | [user-manual.md](./user-manual.md) | [architecture.md](./architecture.md), [operations.md](./operations.md) | `oneapi-gateway/test/cache.test.ts` |
| 模型映射 | `models` | [user-manual.md](./user-manual.md) | [architecture.md](./architecture.md) | `litellm-service/test/test_config.py` |
| Guardrails | 注入检测、内网 IP 拦截、PII 脱敏 | [user-manual.md](./user-manual.md) | [operations.md](./operations.md), [development.md](./development.md) | `oneapi-gateway/test/guardrails.test.ts` |
| Batch | `/v1/batches` + worker 队列消费 | [user-manual.md](./user-manual.md) | [deployment.md](./deployment.md), [architecture.md](./architecture.md) | `oneapi-gateway/test/batch.api.test.ts` |
| Dashboard/Admin API | `/dashboard` + `/admin/api/*` | [user-manual.md](./user-manual.md) | [operations.md](./operations.md) | `oneapi-gateway/test/dashboard.api.test.ts` |
| Chat UI/API | `/chat` + `/chat-api/*` 会话管理 | [user-manual.md](./user-manual.md) | [architecture.md](./architecture.md), [deployment.md](./deployment.md) | smoke chat 场景 |
| 可观测性 | `/metrics`、`usage_events`、TTFT/TPS | [user-manual.md](./user-manual.md) | [operations.md](./operations.md), [architecture.md](./architecture.md) | metrics 抓取 + Dashboard usage |
| 部署模式 | Compose 完整模式 | [deployment.md](./deployment.md) | [operations.md](./operations.md) | `docker compose up -d --build` |
| CI/发布门禁 | 构建、测试、doc-audit、compose smoke | [development.md](./development.md) | [operations.md](./operations.md), [../scripts/test-all.sh](../scripts/test-all.sh) | GitHub Actions `ci.yml` |

## 2. 配置键映射（YAML-only）

单一配置源：`config/easyai.yaml`（网关 + batch）。

| 配置键 | 对应能力 | 相关文档 |
|---|---|---|
| `app.*` | 运行环境、端口和日志级别 | [deployment.md](./deployment.md), [operations.md](./operations.md) |
| `secrets.api_keys` | 鉴权策略 | [user-manual.md](./user-manual.md), [architecture.md](./architecture.md) |
| `secrets.internal_token` | 内部调用安全 | [deployment.md](./deployment.md), [operations.md](./operations.md) |
| `secrets.admin_password` | Dashboard 管理登录 | [user-manual.md](./user-manual.md) |
| `secrets.postgres_password` | 数据库连接 | [deployment.md](./deployment.md) |
| `providers.*` | 上游供应商 | [deployment.md](./deployment.md), [architecture.md](./architecture.md) |
| `models.*` | 对外模型名 | [user-manual.md](./user-manual.md), [architecture.md](./architecture.md) |

## 3. 维护流程约定

1. 功能变更先更新产品/API文档：[user-manual.md](./user-manual.md)
2. 同步架构与链路文档：[architecture.md](./architecture.md)
3. 同步运维与验收步骤：[operations.md](./operations.md)
4. 同步部署变更：[deployment.md](./deployment.md)
5. 更新本矩阵（对外/对内两份）
