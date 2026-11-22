#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
compose_file="${COMPOSE_FILE:-$root/docker-compose.yml}"

with_redis="false"
assume_yes="false"

usage() {
  cat <<'EOF'
用法:
  ./scripts/reset-db.sh [选项]

说明:
  清空 EasyAI 的业务数据（batch 表）。LiteLLM 的密钥/用量数据在它自己的表里，
  需要清理请使用控制台或直接操作数据库。

选项:
  --with-redis   同时清空 Redis 缓存和限流计数
  --yes, -y      跳过确认提示
  --help, -h     显示帮助

默认清空的表:
  batch_items, batches

示例:
  ./scripts/reset-db.sh
  ./scripts/reset-db.sh --with-redis --yes
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
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

compose_args=()
IFS=':' read -r -a compose_files <<< "$compose_file"
for f in "${compose_files[@]}"; do
  compose_args+=("-f" "$f")
done

if ! docker compose "${compose_args[@]}" ps postgres >/dev/null 2>&1; then
  echo "未检测到 compose 项目，请先在项目根目录执行 docker compose up -d。" >&2
  exit 1
fi

sql="TRUNCATE TABLE batch_items, batches RESTART IDENTITY CASCADE;"
summary="清空 batches、batch_items"
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
docker compose "${compose_args[@]}" stop oneapi batch_worker >/dev/null

echo "[2/4] 清空 Postgres 数据 ..."
docker compose "${compose_args[@]}" exec -T postgres \
  psql -U oneapi -d oneapi -v ON_ERROR_STOP=1 -c "$sql" >/dev/null

if [[ "$with_redis" == "true" ]]; then
  echo "[3/4] 清空 Redis ..."
  docker compose "${compose_args[@]}" exec -T redis redis-cli FLUSHALL >/dev/null
else
  echo "[3/4] 跳过 Redis 清理"
fi

echo "[4/4] 启动 oneapi 和 batch_worker ..."
docker compose "${compose_args[@]}" start oneapi batch_worker >/dev/null

echo "完成: $summary"
