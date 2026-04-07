# EasyAI 优化验收清单 (Optimization Checklist)

## 🔴 P0: 核心性能与降本

### 1. 流式响应拦截与缓存支持 (Streaming Cache)
- [x] 发送 `stream: true` 请求，检查 Redis 是否存入拼接后的文本。
- [x] 第二次发送完全相同的 `stream: true` 请求，检查是否命中缓存。
- [x] 验证命中缓存时，客户端是否依然呈现“打字机”分块下发效果。
- [x] 配置回放节奏（如 `cache.replay_chunk_delay_ms`），验证回放速度是否按预期生效。
- [x] 验证 `temperature > 0` 时缓存是否被正确跳过（保持多样性）。

### 2. TTFT (首字延迟) 监控与指标导出
- [x] 检查 `usage_events` 数据库表，确认 `ttft_ms` 字段非空且数值合理。
- [x] 访问 `/metrics` 接口，验证 `easyai_ttft_seconds` 指标是否正常导出。
- [x] 访问 `/metrics` 接口，验证 `easyai_tps` 指标是否正常导出。
- [x] 在 Grafana 中确认是否能按 `route/model/cached` 维度聚合展示 TTFT/TPS（tenant 维度可通过 `usage_events` 聚合实现）。

---

## 🟡 P1: 业务可用性与产品化

### 3. 多上游智能动态路由与故障降级
- [x] 手动模拟一个上游节点返回 `503 Service Unavailable` 或 `429 Too Many Requests`。
- [x] 观察响应头 `X-Upstream`，确认网关自动切换到备选上游节点并返回成功。
- [x] 确认客户端收到的最终响应成功（用户侧无感知）。

### 4. 可视化管理后台 (Dashboard)
- [x] 在 UI 生成一个 API Key，验证该 Key 是否能立刻调用网关。
- [x] 在 UI 修改某个租户的 RPM/TPM 阈值，验证请求侧是否立即生效，并检查 Redis 中 `tenantcfg:v1:<tenantId>` 是否更新。
- [x] 确认 UI 上的消耗统计图表数据与数据库 `usage_events` 一致。

---

## 🟢 P2: 安全合规与高级场景

### 5. AI 安全护栏与敏感信息脱敏 (Guardrails)
- [x] 输入一段包含虚构手机号的 Prompt，验证输出是否被正确掩码。
- [x] 测试 Prompt 注入攻击 payload（如 "Ignore all previous instructions..."），验证网关是否拦截。
- [x] 输入包含内网敏感 IP（如 `10.0.0.1`）时，验证网关返回 `400 Bad Request`。

### 6. 异步批处理接口支持 (Batch API)
- [x] 提交一个包含 10 条请求的批处理任务，验证是否返回 `batch_id`。
- [x] 等待一段时间，验证任务状态是否变为 `completed`。
- [x] 下载结果文件，确认请求的响应内容均正确无误。
