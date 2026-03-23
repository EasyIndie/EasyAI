# EasyAI 优化任务拆解 (Optimization Tasks)

## 🔴 P0: 核心体验与降本 (优先级：最高)

### 1. 流式响应拦截与缓存支持 (Streaming Cache)
*   [x] **Task 1.1**: 在 `OneAPI Gateway` 中实现 `stream` 请求的流劫持逻辑。
*   [x] **Task 1.2**: 在 `proxy.ts` 中添加异步拼接响应文本并写入 Redis 的功能。
*   [x] **Task 1.3**: 实现缓存命中时的 SSE 模拟发送逻辑（打字机效果）。
*   [x] **验收标准**: `stream: true` 请求在第二次发送相同 Prompt 时，响应时间降低 80% 以上。

### 2. TTFT (首字延迟) 监控与指标导出
*   [x] **Task 2.1**: 修改网关请求流程，记录收到第一个 chunk 的毫秒级时间戳。
*   [x] **Task 2.2**: 在 Prometheus 指标中增加 `easyai_ttft_seconds` 直方图。
*   [x] **Task 2.3**: 在 PostgreSQL 的 `usage_events` 表中增加 `ttft_ms` 字段并持久化。
*   [x] **验收标准**: Grafana 能够按模型/租户展示首字延迟趋势。

---

## 🟡 P1: 业务可用性与产品化 (优先级：中)

### 3. 多上游智能动态路由与故障降级
*   [x] **Task 3.1**: 在 LiteLLM 配置文件中定义模型别名及其对应的多个后端实例。
*   [x] **Task 3.2**: 在 Gateway 层实现对 `429/5xx` 错误的捕获，并触发自动重试或切换至备选实例。
*   [x] **验收标准**: 单个上游节点失效时，请求能无感切换至备用上游节点。

### 4. 可视化管理后台 (Dashboard) 核心功能
*   [x] **Task 4.1**: 搭建管理后台前端基础架构 (React)。
*   [x] **Task 4.2**: 实现 API Key 的可视化生成、禁用与 RPM 配额管理。
*   [x] **Task 4.3**: 实现租户 Quota (RPM/TPM) 的在线配置并下发至 Redis。
*   [x] **验收标准**: 管理员能直接在 UI 禁用某个租户，并在 1 分钟内生效。

---

## 🟢 P2: 安全合规与高级场景 (优先级：低)

### 5. AI 安全护栏与敏感信息脱敏 (Guardrails)
*   [x] **Task 5.1**: 实现 Prompt 前置过滤器，拦截常见的注入攻击词。
*   [x] **Task 5.2**: 实现 PII (个人敏感信息) 脱敏插件，支持对输出中的手机号/身份证掩码。
*   [x] **验收标准**: 输入包含内网敏感 IP 时，网关返回 `400 Bad Request`。

### 6. 异步批处理接口支持 (Batch API)
*   [x] **Task 6.1**: 实现 `/v1/batches` 标准接口，将任务压入 Redis 队列。
*   [x] **Task 6.2**: 编写独立的 Worker 服务负责低优先级消费队列。
*   [x] **验收标准**: 支持通过 `batch_id` 查询任务进度和下载结果文件。

---

## 🔵 P3: 管理后台增强 (优先级：低)

### 7. Dashboard CRUD 完整性增强 (API Keys / Tenants)
*   [x] **Task 7.1**: 为 API Key 与 Tenant 补齐 Delete/Force Delete 能力，并保持审计可用。
*   [x] **Task 7.2**: 在 Dashboard 提升租户绑定体验（可搜索选择、显示绑定数、一键解绑、分页/搜索）。
*   [x] **Task 7.3**: 对 Admin 写接口增加防 CSRF 保护（要求 `x-oneapi-admin-action: 1`），并将 delete 的 `force` 迁移到 body `{ "force": true }`。
*   [x] **验收标准**: 管理员可在 UI 完成 key/tenant 的创建、绑定、解绑、删除，且写操作必须携带防 CSRF 头。
