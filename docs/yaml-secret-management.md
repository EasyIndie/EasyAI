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

```bash
cp config/easyai.production.example.yaml config/easyai.production.local.yaml
# 编辑并替换所有 REPLACE_WITH_*
python3 scripts/render-local-compose.py config/easyai.production.local.yaml > docker-compose.local.yml
```

启动：

```bash
docker compose -f docker-compose.yml -f docker-compose.local.yml up -d --build
```

## 3. 必换敏感项

- `secrets.admin_password`
- `secrets.api_keys`
- `secrets.internal_token`
- `secrets.postgres_password`
- `providers.<name>.api_key`（如 OpenAI / DeepSeek）

## 4. 运行时保护

- `app.env: production` 时，网关会拒绝默认/占位敏感值
- LiteLLM 会拒绝生产环境下的占位 provider key
