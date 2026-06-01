# 开发与测试

## 1. 环境

- Node 版本：见 `.nvmrc`（当前为 `25`）
- Python：`3.11+`
- Docker + Docker Compose

## 2. 本地开发常用命令

启动整套服务：

```bash
docker compose up -d --build
docker compose exec -T ollama ollama pull qwen2.5:0.5b
```

网关测试：

```bash
cd oneapi-gateway
npm install
npm test
```

前端构建：

```bash
cd oneapi-gateway/admin-ui
npm ci && npm run build

cd ../chat-ui
npm ci && npm run build
```

## 3. 文档一致性校验

```bash
cd oneapi-gateway
npm run doc-audit
```

## 4. CI 对齐

仓库 CI 使用：`.github/workflows/ci.yml` -> `scripts/test-all.sh`。

本地执行全量门禁：

```bash
bash scripts/test-all.sh
```

仅执行对外服务验收（smoke）：

```bash
./scripts/smoke-compose.sh
```

## 5. 安全基线（生产）

- 生产配置从 `config/easyai.production.example.yaml` 复制到本地私有文件
- 必须替换 `REPLACE_WITH_*`、`dev-key`、`dev-internal` 等默认值
- 不要提交 `*.local.yaml`、`.env`、密钥文件
