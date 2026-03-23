# P3：Dashboard CRUD 完整性增强（API Keys / Tenants）

## 1. 背景

当前 Dashboard 已具备：
- API Key 创建、Revoke、设置 key 级 RPM、绑定 tenant（但绑定 tenant 只能手动输入 tenant_id）
- Tenant 创建/更新（Upsert）、配置 RPM/TPM、禁用 tenant（但无法删除 tenant）

存在的管理体验缺口：
- Key 绑定 tenant 仅支持手填 tenant_id，不支持列表选择/搜索
- API Key 无删除能力（只能 revoke）
- Tenant 无删除能力（只能 upsert/禁用）

本阶段目标是补齐管理闭环，提升管理员操作效率与数据清理能力，同时保持安全性与可审计性。

## 2. 目标与非目标

### 2.1 目标

- Key 绑定 tenant：支持在 UI 里按 tenant 列表选择并支持搜索过滤
- API Key：支持删除（删除前置条件明确，避免误删仍可用的 key）
- Tenant：支持删除（删除时考虑 tenant 与 key 绑定关系）
- 新增/调整 Admin API 以支持上述 UI 操作

### 2.2 非目标

- 不引入复杂权限系统（仍沿用 BasicAuth 管理鉴权）
- 不做批量导入/导出 key、tenant
- 不改变现有计费/usage_events 表结构与统计口径

## 3. 设计原则

- **安全优先**：默认避免删除“仍有效的 API Key”，需先 revoke 或显式 force
- **数据一致性**：删除 tenant 时对其关联 key 做可预期的处理（默认阻止，显式 force 才解绑）
- **向后兼容**：保持现有接口不破坏；新增接口均为可选增强
- **UI 简洁**：不引入新组件库，沿用当前纯 React + 原生控件方式

## 4. API 规格（Admin API）

### 4.1 删除 API Key

- **Endpoint**：`DELETE /admin/api/keys/:id`
- **Auth**：BasicAuth（同其他 `/admin/api/*`）
- **Header**
  - `x-oneapi-admin-action: 1`（写操作必须携带，用于降低 CSRF 风险）
- **Body**
  - `{ "force": true }`（可选）：允许删除未 revoke 的 key（默认不允许）
- **行为**
  - 默认：仅允许删除 `revoked_at != null` 的 key；否则返回 `409 Conflict`
  - `force=true`：直接删除该 key 记录
- **Response**
  - `200 { ok: true }`
  - `404 { error: "not found" }`
  - `409 { error: "key must be revoked before delete" }`

说明：usage_events 通过 `api_key_hash` 记录审计信息，删除 api_keys 行不影响历史审计。

### 4.2 删除 Tenant

- **Endpoint**：`DELETE /admin/api/tenants/:tenantId`
- **Auth**：BasicAuth
- **Header**
  - `x-oneapi-admin-action: 1`
- **Body**
  - `{ "force": true }`（可选）：允许删除仍被 key 引用的 tenant（会先解绑）
- **行为**
  - 若存在 `api_keys.tenant_id = tenantId`：
    - 默认：返回 `409 Conflict`，提示先解绑或使用 force
    - `force=true`：将关联 key 的 `tenant_id` 置空，再删除 tenant
  - 同步删除 Redis `tenantcfg:v1:<tenantId>`（若存在）
- **Response**
  - `200 { ok: true }`
  - `404 { error: "not found" }`
  - `409 { error: "tenant still has keys bound" }`

## 5. UI 规格（Dashboard）

### 5.1 API Keys 页面：tenant 绑定选择/搜索

- 在每一行 Key 的 Tenant 列：
  - 从“纯文本输入框”升级为“输入 + 列表建议”或“可搜索下拉”
  - 数据源：`GET /admin/api/tenants`（已有）
  - 支持：
    - 输入时按包含匹配过滤 tenant_id
    - 选择 tenant 后提交绑定
    - 支持清空 tenant（解绑）
- 交互要求：
  - 对 revoked 的 key 仍保持禁用编辑（与现有逻辑一致）

### 5.2 API Keys 页面：Delete

- Actions 增加 `Delete` 按钮
- 默认启用规则：
  - key 已 revoke 才允许删除（否则按钮置灰或点击提示需先 revoke）
  - 支持二次确认（confirm）

### 5.3 Tenants 页面：Delete

- 每个 tenant 行增加 `Delete` 按钮
- 默认启用规则：
  - tenant 未被任何 key 绑定时可直接删除
  - 若仍有 key 绑定：
    - UI 给予明确提示
    - 支持 `Force Delete`（会解绑所有相关 key 后删除 tenant）

## 6. 验收标准（与 checklist 对齐）

- 在 UI 绑定 tenant 时可通过列表选择/搜索完成，不需要手工记 tenant_id
- API Key 可删除，且默认要求先 revoke
- Tenant 可删除；若 tenant 仍绑定 key，默认阻止并支持 force 解绑后删除
- 删除 tenant 后，Redis 中 `tenantcfg:v1:<tenantId>` 不再存在（或被删除）
