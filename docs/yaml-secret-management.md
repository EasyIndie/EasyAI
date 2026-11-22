# YAML 密钥管理

项目采用 YAML 配置。规则是：
- 入仓文件只放开发默认值或占位符
- 真实生产密钥只放本地私有文件（不入仓）

## 1. 文件角色

- 入仓开发配置：`config/easyai.development.yaml`
- 入仓生产示例：`config/easyai.production.example.yaml`
- 本地生产配置：`config/easyai.production.local.yaml`（git ignore）
- 生产 override：`docker-compose.local.yml`（git ignore）

## 2. 生产配置步骤

步骤见[部署与运维 §2](./deployment.md#2-生产环境本地私有配置)，这里只强调与本文件相关的规则：

- 私有文件与 override 都在 `.gitignore` 中，不要提交
- 任何 `REPLACE_WITH_*`、`dev-key`、`dev-internal`、`oneapi` 结尾值都必须替换
- `app.env: production` 时网关会主动拒绝这些占位值

## 3. 必换敏感项

- `secrets.master_key`（控制台登录密码 + 网关访问 LiteLLM 的内部主密钥，不对外）
- `secrets.salt_key`（加密控制台保存的厂商密钥；不填会由 `master_key` 派生，设置后不要再改）
- `secrets.api_keys`
- `secrets.internal_token`
- `secrets.postgres_password`
- `providers.<name>.api_key`（接入云端厂商时）

## 4. 运行时保护

- `app.env: production` 时，网关会拒绝默认/占位敏感值（缺少 `secrets.master_key` 也会直接启动失败）
- LiteLLM 配置由 `scripts/render-litellm-config.py` 生成，生产环境请确保 `providers.<name>.api_key` 已替换
