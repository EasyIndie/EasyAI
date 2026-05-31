#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
compose_file="${COMPOSE_FILE:-$root/docker-compose.yml}"
backup_dir="${BACKUP_DIR:-$root/backups/postgres}"
stamp="$(date +%Y%m%d_%H%M%S)"
out="$backup_dir/oneapi_${stamp}.dump"

mkdir -p "$backup_dir"

compose_args=()
IFS=':' read -r -a compose_files <<< "$compose_file"
for f in "${compose_files[@]}"; do
  compose_args+=("-f" "$f")
done

if ! docker compose "${compose_args[@]}" ps postgres >/dev/null 2>&1; then
  echo "未检测到 compose postgres 服务，请先启动 docker compose。" >&2
  exit 1
fi

echo "备份 Postgres 到: $out"
docker compose "${compose_args[@]}" exec -T postgres \
  pg_dump -U oneapi -d oneapi -Fc > "$out"

echo "完成: $out"
