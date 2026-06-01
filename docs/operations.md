# 运行手册（Operations）

## 1. 发布前检查

### 1.1 启动与健康

```bash
docker compose up -d --build
curl -sS http://localhost:3004/healthz
curl -sS http://localhost:3004/openapi.json | head
```

### 1.2 快速 smoke

```bash
./scripts/smoke-compose.sh
```

可指定地址：

```bash
BASE_URL=http://localhost:3004 ./scripts/smoke-compose.sh
```

### 1.3 生产前最小安全检查

```bash
grep -E 'REPLACE_WITH_|dev-key|dev-internal|postgres_password: "oneapi"' config/easyai.production.local.yaml
```

预期：不应命中默认值或占位符。

## 2. 常见故障排查

### 2.1 先看日志

```bash
docker compose logs --tail=200 oneapi litellm batch_worker
```

### 2.2 常见错误

- `401 unauthorized`：凭据错误或缺失
- `429 rate limited`：触发限流
- `400 model not allowed`：请求模型不在 `models` 配置中
- `503`（Batch）：`internal_token` 未配置或 worker 不可用
- `502/504`：上游模型服务不可达或超时

### 2.3 Redis 快速检查（可选）

```bash
docker compose exec -T redis redis-cli LLEN 'batch:q:v1'
docker compose exec -T redis redis-cli --raw KEYS 'cache:v1:*' | head
```

## 3. 备份与恢复

备份：

```bash
./scripts/backup-postgres.sh
```

恢复：

```bash
./scripts/restore-postgres.sh backups/postgres/oneapi_YYYYmmdd_HHMMSS.dump --yes
```

线上 override 需要显式传 Compose 文件：

```bash
COMPOSE_FILE="docker-compose.yml:docker-compose.local.yml" ./scripts/backup-postgres.sh
COMPOSE_FILE="docker-compose.yml:docker-compose.local.yml" ./scripts/restore-postgres.sh backups/postgres/oneapi_YYYYmmdd_HHMMSS.dump --yes
```

## 4. 数据重置（开发场景）

```bash
./scripts/reset-db.sh --usage-only
./scripts/reset-db.sh
./scripts/reset-db.sh --all --with-redis --yes
```

注意：不要直接使用 `docker compose down -v`，会删除模型卷。
