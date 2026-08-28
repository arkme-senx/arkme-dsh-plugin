#!/usr/bin/env bash
set -euo pipefail

: "${ARKME_BACKEND_BASE_URL:?ARKME_BACKEND_BASE_URL is required}"
: "${ARKME_CI_TRIGGER_SECRET:?ARKME_CI_TRIGGER_SECRET is required}"

if [[ ! "$ARKME_BACKEND_BASE_URL" =~ ^https://[A-Za-z0-9.-]+(:[0-9]+)?/?$ ]]; then
  printf 'Arkme Backend 地址必须是没有路径、查询参数或用户信息的 HTTPS 地址。\n' >&2
  exit 1
fi
if [[ "$ARKME_CI_TRIGGER_SECRET" == *$'\r'* || "$ARKME_CI_TRIGGER_SECRET" == *$'\n'* ]]; then
  printf 'Arkme CI 触发密钥格式无效。\n' >&2
  exit 1
fi

endpoint="${ARKME_BACKEND_BASE_URL%/}/api/public/v1/ci/arkme-plugin/build"
umask 077
response_file="$(mktemp)"
trap 'rm -f "$response_file"' EXIT

if ! http_status="$(
  curl \
    --silent \
    --proto '=https' \
    --tlsv1.2 \
    --max-redirs 0 \
    --connect-timeout 10 \
    --max-time 30 \
    --request POST \
    --header "Authorization: Bearer ${ARKME_CI_TRIGGER_SECRET}" \
    --header 'Accept: application/json' \
    --output "$response_file" \
    --write-out '%{http_code}' \
    "$endpoint"
)"; then
  printf '请求 Arkme 构建失败：Backend 请求未完成。\n' >&2
  exit 1
fi

if [[ "$http_status" != '202' ]]; then
  printf '请求 Arkme 构建失败：Backend 未接受请求（HTTP %s）。\n' "$http_status" >&2
  exit 1
fi

if ! grep -Eq '"queued"[[:space:]]*:[[:space:]]*true([[:space:]}]|$)' "$response_file"; then
  printf '请求 Arkme 构建失败：Backend 未确认任务进入队列。\n' >&2
  exit 1
fi

printf 'Arkme 构建请求已由 Backend 接受并进入队列。\n'
