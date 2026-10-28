#!/usr/bin/env bash
set -euo pipefail
task_plugin_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
: "${ARKME_DSH_CHECKOUT:?Set ARKME_DSH_CHECKOUT to an unmodified official DSH checkout}"
: "${ARKME_PACKED_PROFILE:?Set ARKME_PACKED_PROFILE to a fresh disposable profile installed with dsh plugin add artifact.tgz}"
export ARKME_DSH_CHECKOUT ARKME_PACKED_PROFILE
test -z "$(git -C "$ARKME_DSH_CHECKOUT" status --porcelain --untracked-files=no)"
task_tls_root="$(mktemp -d "${TMPDIR:-/tmp}/arkme-recording-tls.XXXXXX")"
trap 'rm -f "$task_tls_root/key.pem" "$task_tls_root/cert.pem"; rmdir "$task_tls_root"' EXIT
openssl req -x509 -newkey rsa:2048 -nodes -days 1 -subj '/CN=localhost' \
  -addext 'subjectAltName=IP:127.0.0.1' \
  -keyout "$task_tls_root/key.pem" -out "$task_tls_root/cert.pem" >/dev/null 2>&1
chmod 600 "$task_tls_root/key.pem"
export NODE_EXTRA_CA_CERTS="$task_tls_root/cert.pem"
export ARKME_E2E_TLS_KEY="$task_tls_root/key.pem"
node "$task_plugin_root/scripts/verify-recording-sdk-consumer.mjs"
cd "$ARKME_DSH_CHECKOUT"
pnpm exec vitest run --config "$task_plugin_root/vitest.recording-e2e.config.mts"
