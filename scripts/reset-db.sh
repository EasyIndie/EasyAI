#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
compose_file="$root/docker-compose.yml"

mode="app"
with_redis="false"
assume_yes="false"

usage() {
  cat <<'EOF'
用法:
  ./scripts/reset-db.sh [选项]

说明:
  一键清空当前项目的数据库数据，仅作用于 docker-compose.yml 中的 Postgres/Redis。
  不会删除 Ollama 模型卷，不会删除源码或配置文件。

选项:
  --usage-only   仅清空 usage_events 表
  --all          清空 OneAPI 业务表（默认）
  --with-redis   同时清空 Redis 缓存和限流计数
  --yes, -y      跳过确认提示
  --help, -h     显示帮助

默认清空的表:
  batch_items, batches, usage_events, api_keys, tenants

示例:
  ./scripts/reset-db.sh
  ./scripts/reset-db.sh --usage-only
  ./scripts/reset-db.sh --all --with-redis --yes
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --usage-only)
      mode="usage"
      shift
      ;;
    --all)
      mode="app"
      shift
      ;;
    --with-redis)
      with_redis="true"
      shift
      ;;
    --yes|-y)
      assume_yes="true"
      shift
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    *)
      echo "未知参数: $1" >&2
      usage
      exit 1
      ;;
  esac
done

if ! command -v docker >/dev/null 2>&1; then
  echo "未找到 docker 命令，请先安装 Docker。" >&2
  exit 1
fi

if ! docker compose -f "$compose_file" ps postgres >/dev/null 2>&1; then
  echo "未检测到 compose 项目，请先在项目根目录执行 docker compose up -d。" >&2
  exit 1
fi

if [[ "$mode" == "usage" ]]; then
  sql="TRUNCATE TABLE usage_events RESTART IDENTITY;"
  summary="仅清空 usage_events 用量统计表"
else
  sql="TRUNCATE TABLE batch_items, batches, usage_events, api_keys, tenants RESTART IDENTITY CASCADE;"
  summary="清空 batches、batch_items、usage_events、api_keys、tenants"
fi

if [[ "$with_redis" == "true" ]]; then
  summary="$summary，并清空 Redis"
fi

echo "即将执行: $summary"
echo "Compose 文件: $compose_file"

if [[ "$assume_yes" != "true" ]]; then
  read -r -p "确认继续吗？输入 yes 继续: " confirm
  if [[ "$confirm" != "yes" ]]; then
    echo "已取消。"
    exit 0
  fi
fi

echo "[1/4] 停止 oneapi 和 batch_worker ..."
docker compose -f "$compose_file" stop oneapi batch_worker >/dev/null

echo "[2/4] 清空 Postgres 数据 ..."
docker compose -f "$compose_file" exec -T postgres \
  psql -U oneapi -d oneapi -v ON_ERROR_STOP=1 -c "$sql" >/dev/null

if [[ "$with_redis" == "true" ]]; then
  echo "[3/4] 清空 Redis ..."
  docker compose -f "$compose_file" exec -T redis redis-cli FLUSHALL >/dev/null
else
  echo "[3/4] 跳过 Redis 清理"
fi

echo "[4/4] 启动 oneapi 和 batch_worker ..."
docker compose -f "$compose_file" start oneapi batch_worker >/dev/null

echo "完成: $summary"
