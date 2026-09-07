#!/usr/bin/env bash
set -euo pipefail
task_plugin_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
task_workspace="$(cd "$task_plugin_root/.." && pwd)"
export ARKME_DSH_CHECKOUT="${ARKME_DSH_CHECKOUT:-$task_workspace/deepseek-harness}"
: "${ARKME_PACKED_PROFILE:?Set ARKME_PACKED_PROFILE to a fresh profile installed with dsh plugin add artifact.tgz}"
source "${JOTMO_RECORD_E2E_RECORD_REPO_PATH:-$task_workspace/jotmo-record}/test/e2e/compose_helpers.sh"

run_dsh_input_cross_test() (
  task_tls_root="$(mktemp -d "${TMPDIR:-/tmp}/arkme-input-tls.XXXXXX")"
  # This directory contains only this invocation's generated TLS test identity.
  trap 'rm -f "$task_tls_root/key.pem" "$task_tls_root/cert.pem"; rmdir "$task_tls_root"' EXIT
  openssl req -x509 -newkey rsa:2048 -nodes -days 1 -subj '/CN=localhost' \
    -addext 'subjectAltName=IP:127.0.0.1' \
    -keyout "$task_tls_root/key.pem" -out "$task_tls_root/cert.pem" >/dev/null 2>&1
  chmod 600 "$task_tls_root/key.pem"
  export NODE_EXTRA_CA_CERTS="$task_tls_root/cert.pem"
  export ARKME_E2E_TLS_KEY="$task_tls_root/key.pem"
  export ARKME_RECORD_E2E_ORIGIN="http://$JOTMO_RECORD_E2E_HOST:$JOTMO_RECORD_E2E_RECORD_PORT"
  cd "$ARKME_DSH_CHECKOUT"
  pnpm exec vitest run --config "$task_plugin_root/vitest.dsh-input-e2e.config.mts"
)

e2e_run_compose_go_test "dsh-input-cross" \
  "packed plugin + DSH browser + SDK + Tool + real Record API" run_dsh_input_cross_test
