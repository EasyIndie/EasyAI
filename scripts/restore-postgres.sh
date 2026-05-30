#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
compose_file="$root/docker-compose.yml"

usage() {
  cat <<'EOF'
用法:
  ./scripts/restore-postgres.sh <backup.dump> --yes

说明:
  从 scripts/backup-postgres.sh 生成的 pg_dump custom 格式备份恢复数据库。
  恢复会清理并重建 public schema，请确认目标环境正确。
EOF
}

backup="${1:-}"
assume_yes="${2:-}"

if [[ -z "$backup" || "$backup" == "--help" || "$backup" == "-h" ]]; then
  usage
  exit 0
fi

if [[ ! -f "$backup" ]]; then
  echo "备份文件不存在: $backup" >&2
  exit 1
fi

if [[ "$assume_yes" != "--yes" ]]; then
  echo "恢复会覆盖当前 oneapi 数据库 public schema。"
  echo "请使用 --yes 明确确认。"
  exit 1
fi

echo "[1/4] 停止 oneapi 和 batch_worker ..."
docker compose -f "$compose_file" stop oneapi batch_worker >/dev/null

echo "[2/4] 重建 public schema ..."
docker compose -f "$compose_file" exec -T postgres \
  psql -U oneapi -d oneapi -v ON_ERROR_STOP=1 \
  -c 'DROP SCHEMA public CASCADE; CREATE SCHEMA public; GRANT ALL ON SCHEMA public TO oneapi;' >/dev/null

echo "[3/4] 恢复备份 ..."
docker compose -f "$compose_file" exec -T postgres \
  pg_restore -U oneapi -d oneapi --no-owner --role=oneapi < "$backup"

echo "[4/4] 启动 oneapi 和 batch_worker ..."
docker compose -f "$compose_file" start oneapi batch_worker >/dev/null

echo "完成: $backup"
