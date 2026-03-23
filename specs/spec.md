# EasyAI 优化路线图与技术规约 (Optimization Spec)

## 1. 项目愿景与目标
EasyAI 作为一个 LLM 网关/中台，其核心目标是**高性能、高可用、可观测、低成本**。本规约旨在解决当前流式输出缓存缺失、观测性不精细、路由策略单一等痛点，通过分阶段落地实现从“可用”到“企业级生产就绪”的转变。

---

## 2. 核心优化模块说明

### 2.1 P0：核心性能与降本 (Streaming Cache & TTFT)

#### A. 流式输出缓存 (Streaming Cache Support)
*   **目标**：解决 `stream: true` 请求无法命中缓存导致的高成本和高延迟问题。
*   **技术实现**：
    *   在 `OneAPI Gateway` 的 `proxy.ts` 中引入流式响应拦截器。
    *   使用缓冲区（Buffer）在 SSE 数据透传时，异步拼接 chunk 内容。
    *   在收到 `[DONE]` 后，将拼接好的完整字符串存入 Redis，Key 生成逻辑：`hash(prompt + parameters + model_name)`。
    *   缓存命中时，由网关模拟 SSE 发送流程，支持配置分片回放节奏：
        *   `fixed`：每个 chunk 固定延迟（可配最大总回放时长）
        *   `original`：按上游真实 chunk 间隔复刻（可配最大总回放时长用于缩放）

#### B. 细粒度观测性 (Observability)
*   **目标**：引入大模型特有的性能指标（TTFT, TPS）。
*   **技术实现**：
    *   **TTFT (Time To First Token)**：记录请求发起至第一个 chunk 返回的时间差。
    *   **TPS (Tokens Per Second)**：计算总生成的 tokens 除以 (总响应时间 - TTFT)。
    *   **数据集成**：在 `usage_events` 表中新增 `ttft_ms`, `total_tokens`, `prompt_tokens`, `completion_tokens`, `tps` 等字段。
    *   **指标导出**：Prometheus 导出 `easyai_ttft_seconds` 与 `easyai_tps`。

---

### 2.2 P1：业务可用性与产品化 (Dynamic Routing & Dashboard)

#### C. 智能动态路由与故障降级 (Dynamic Routing)
*   **目标**：提高系统可用性，避免单一厂商故障导致服务中断。
*   **技术实现**：
    *   支持为同一逻辑模型名配置多个 Upstream。
    *   实现自动 Fallback：捕获 `429`（限流）和 `5xx`（服务异常），自动轮询备选模型或备选厂商（如 Azure OpenAI 作为 OpenAI 官方的 Fallback）。

#### D. 可视化管理后台 (Dashboard)
*   **目标**：将管理操作可视化，提供数据洞察。
*   **技术实现**：
    *   使用 React + TypeScript 构建单页应用（SPA），构建产物由网关在 `/dashboard` 路径静态托管。
    *   复用网关现有的管理鉴权（BasicAuth），同时保护 `/dashboard/*` 与 `/admin/api/*`。
    *   提供管理 API：
        *   用量概览：`GET /admin/api/usage`
        *   API Key 管理：`GET/POST /admin/api/keys`、`POST /admin/api/keys/:id/revoke`
        *   Key 级 RPM 配额：`PUT /admin/api/keys/:id/rpm`
        *   租户配额：`GET /admin/api/tenants`、`PUT /admin/api/tenants/:tenantId`
        *   Key 绑定租户：`PUT /admin/api/keys/:id/tenant`
    *   持久化：新增 `api_keys` 表保存 `key_hash/key_prefix/revoked_at/rpm_limit`，网关鉴权支持从 DB 校验 Key（同时保留环境变量 Key 兼容）。
    *   配额下发：租户配额更新后写入 Redis `tenantcfg:v1:<tenantId>`（短 TTL），请求侧优先从 Redis 读取并立即生效，DB 作为真实来源。

---

### 2.3 P2：安全合规与高级场景 (Guardrails & Batch)

#### E. AI 安全护栏 (LLM Guardrails)
*   **目标**：敏感信息过滤与合规审计。
*   **技术实现**：
    *   前置过滤器：对输入 `messages/prompt` 扫描注入关键字与内网 IP，命中直接返回 `400`。
    *   PII 脱敏：对输出进行掩码（覆盖非流式 JSON、流式 SSE 透传、缓存命中回放），避免敏感信息落盘/落缓存。
    *   配置项（环境变量）：
        *   `ONEAPI_GUARDRAILS_ENABLED=0|1`
        *   `ONEAPI_GUARDRAILS_BLOCK_INTERNAL_IP=0|1`
        *   `ONEAPI_GUARDRAILS_INJECTION_KEYWORDS=...`（逗号分隔）
        *   `ONEAPI_GUARDRAILS_PII_MASK_ENABLED=0|1`

#### F. 异步批处理任务 (Batch Processing)
*   **目标**：支持大批量非实时任务，削峰填谷。
*   **技术实现**：
    *   实现 `/v1/batches` 接口（提交任务）、`/v1/batches/:batchId`（查询状态）、`/v1/batches/:batchId/output`（下载结果）。
    *   使用 Redis 队列 `batch:q:v1` 管理任务入队与消费。
    *   Worker 服务异步消费队列，将每条子请求结果写入 `batch_items`，并汇总写入 `batches` 状态。
    *   安全策略：Worker 通过 `ONEAPI_INTERNAL_TOKEN` 调用网关内部认证头 `x-oneapi-internal-token`，避免存储用户明文 API Key。

---

## 3. 架构演进图 (Architecture Evolution)
1.  **Gateway 层**：增加 `Interceptor` 插件（缓存、监控、安全扫描）。
2.  **治理层**：从单一配置演进为从 Redis 读取的动态策略（限流、路由、降级）。
3.  **持久化层**：审计日志增加深度维度。
