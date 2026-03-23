# P3：Dashboard CRUD 完整性增强 - 验收清单

## 1. API Keys：tenant 选择/搜索

- [ ] 打开 Dashboard → API Keys，Tenant 列支持下拉选择或输入搜索 tenant_id
- [ ] 选择某个 tenant 后保存，刷新页面后 tenant 绑定仍正确
- [ ] 清空 tenant 绑定（解绑）后保存，刷新页面后 tenant 为空

## 2. API Keys：Delete

- [ ] 对未 revoke 的 key，Delete 按钮不可直接删除（需先 revoke 或明确提示）
- [ ] revoke 后可以 Delete，删除后列表中不再出现该 key

## 3. Tenants：Delete / Force Delete

- [ ] 创建一个 tenant 且未绑定任何 key，可以直接 Delete
- [ ] 创建 tenant 并绑定至少一个 key：
  - [ ] 默认 Delete 会被阻止并提示 tenant 仍绑定 key
  - [ ] Force Delete 会解绑相关 key 并删除 tenant
- [ ] tenant 删除后，Redis `tenantcfg:v1:<tenantId>` 被清理（GET 返回 nil）

