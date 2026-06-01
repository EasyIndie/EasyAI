#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$root"

mode="${1:-all}"
range="${2:-}"

list_files() {
  case "$mode" in
    staged)
      git diff --cached --name-only --diff-filter=ACMR
      ;;
    range)
      if [[ -z "$range" ]]; then
        echo "usage: $0 range <git-range>" >&2
        exit 2
      fi
      git diff --name-only --diff-filter=ACMR "$range"
      ;;
    all)
      git ls-files
      ;;
    *)
      echo "unknown mode: $mode" >&2
      echo "usage: $0 [all|staged|range <git-range>]" >&2
      exit 2
      ;;
  esac
}

is_excluded_path() {
  local p="$1"
  [[ "$p" =~ ^docs/ ]] && return 0
  [[ "$p" =~ ^README\.md$ ]] && return 0
  [[ "$p" =~ \.md$ ]] && return 0
  [[ "$p" =~ ^config/easyai\.development\.yaml$ ]] && return 0
  [[ "$p" =~ ^config/easyai\.production\.example\.yaml$ ]] && return 0
  [[ "$p" =~ \.example$ ]] && return 0
  [[ "$p" =~ ^oneapi-gateway/test/ ]] && return 0
  return 1
}

patterns=(
  '-----BEGIN (RSA|OPENSSH|EC|DSA|PGP|PRIVATE) PRIVATE KEY-----'
  'sk-[A-Za-z0-9]{24,}'
  'it-[A-Za-z0-9]{24,}'
  '(?i)(api[_-]?key|token|password|secret)[[:space:]]*[:=][[:space:]]*["'"'"'][A-Za-z0-9_./+=-]{24,}["'"'"']'
)

has_errors=0
while IFS= read -r f; do
  [[ -n "$f" ]] || continue
  [[ -f "$f" ]] || continue
  if is_excluded_path "$f"; then
    continue
  fi
  for pat in "${patterns[@]}"; do
    if rg -n --pcre2 "$pat" "$f" >/dev/null 2>&1; then
      echo "[secret-check] potential secret in $f (pattern: $pat)" >&2
      rg -n --pcre2 "$pat" "$f" | sed 's/^/  /' >&2 || true
      has_errors=1
    fi
  done
done < <(list_files)

if git ls-files --error-unmatch config/easyai.production.local.yaml >/dev/null 2>&1; then
  echo "[secret-check] blocked: config/easyai.production.local.yaml is tracked by git." >&2
  echo "  run: git rm --cached config/easyai.production.local.yaml" >&2
  has_errors=1
fi

if [[ $has_errors -ne 0 ]]; then
  echo "[secret-check] blocked: remove/redact secrets before commit/push." >&2
  exit 1
fi

echo "[secret-check] OK"
