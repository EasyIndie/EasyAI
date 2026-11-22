# 开发与测试

## 1. 环境

- Node 版本：见 `.nvmrc`（`22`，与 CI 和 Dockerfile 一致）
- Python：`3.11+`，并安装 `PyYAML`（`python3 -m pip install -r scripts/requirements.txt`）
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
npm ci
npm test
```

LiteLLM 配置生成（改完 `config/*.yaml` 后可本地校验）：

```bash
python3 scripts/render-litellm-config.py config/easyai.development.yaml
```

## 3. 仓库结构

```
oneapi-gateway/   轻量网关（Fastify）：鉴权、限流、/v1 透传、Batch、首页
batch-worker/     Batch 队列消费者
scripts/          YAML→LiteLLM 渲染、compose 渲染、smoke、备份恢复、密钥检查
tools/doc-audit/  文档一致性门禁（环境变量、路由、仓库路径）
config/           唯一的 YAML 配置
docs/             中文文档
```

## 4. 提交前最小检查

```bash
cd oneapi-gateway
npm run build && npm test && npm run doc-audit
cd ../batch-worker && npm run build
```

`doc-audit` 会校验文档里的环境变量、路由和仓库路径是否与代码一致，改完文档务必跑一次。

## 5. CI 对齐

仓库 CI 使用：`.github/workflows/ci.yml` -> `scripts/test-all.sh`。

本地执行全量门禁：

```bash
bash scripts/test-all.sh
```

仅执行对外服务验收（smoke，需要 `curl` + `jq`）：

```bash
./scripts/smoke-compose.sh
# 可覆盖：BASE_URL / CONFIG_FILE / CONSOLE_URL / API_KEY
```

## 6. 安全基线（生产）

- 生产配置从 `config/easyai.production.example.yaml` 复制到本地私有文件
- 必须替换 `REPLACE_WITH_*`、`dev-key`、`dev-internal` 等默认值
- 不要提交 `*.local.yaml`、`.env`、密钥文件

## 7. 提交前密钥检查（必做）

首次在本仓库启用 hooks：

```bash
git config core.hooksPath .githooks
chmod +x .githooks/pre-commit .githooks/pre-push
```

手动检查：

```bash
bash scripts/check-secrets.sh staged
bash scripts/check-secrets.sh all
```
