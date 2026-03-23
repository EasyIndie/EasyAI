# P3：Dashboard CRUD 完整性增强 - 任务拆解

## Task 1：新增 Admin API 删除能力

- 为 API Key 增加 `DELETE /admin/api/keys/:id`（默认仅允许删除已 revoke 的 key，支持 body `{"force": true}`）
- 为 Tenant 增加 `DELETE /admin/api/tenants/:tenantId`（默认阻止仍绑定 key 的 tenant，支持 body `{"force": true}` 解绑后删除，并清理 Redis tenantcfg）
- 为 DB 层增加必要的查询与 delete/update 方法（保持现有 db.ts 风格）

## Task 2：Dashboard UI 补齐三项能力

- API Keys 页面：
  - tenant 绑定由“手输”升级为“可搜索选择”
  - 新增 Delete（含二次确认与禁用规则）
- Tenants 页面：
  - 新增 Delete / Force Delete（含二次确认与明确提示）

## Task 3：测试与文档同步

- 补充后端接口的单元/集成测试（尽量复用现有测试结构）
- 更新 docs/api-reference.md 与 docs/user-manual.md（补充 Delete 能力与行为约束）
- 更新 specs/p3-dashboard-crud/checklist.md 并跑通验收脚本/手工验收步骤
