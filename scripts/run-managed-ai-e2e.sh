#!/usr/bin/env bash
set -euo pipefail
task_plugin_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
: "${ARKME_DSH_CHECKOUT:?Set the unmodified target Harness checkout}"
: "${ARKME_PACKED_PROFILE:?Install an immutable plugin tgz in a fresh DSH profile first}"
: "${JOTMO_INTELLIGENT_CHECKOUT:?Set the Intelligent task checkout}"
: "${MANAGED_AI_TEST_MYSQL_ADDR:?Set isolated loopback MySQL host:port}"
git -C "$ARKME_DSH_CHECKOUT" diff --quiet origin/master HEAD --
test -z "$(git -C "$ARKME_DSH_CHECKOUT" status --porcelain --untracked-files=no)"
task_tls_root="$(mktemp -d "${TMPDIR:-/tmp}/arkme-model-tls.XXXXXX")"
trap 'rm -f "$task_tls_root/key.pem" "$task_tls_root/cert.pem"; rmdir "$task_tls_root"' EXIT
openssl req -x509 -newkey rsa:2048 -nodes -days 1 -subj '/CN=localhost' \
  -addext 'subjectAltName=IP:127.0.0.1' \
  -keyout "$task_tls_root/key.pem" -out "$task_tls_root/cert.pem" >/dev/null 2>&1
chmod 600 "$task_tls_root/key.pem"
export NODE_EXTRA_CA_CERTS="$task_tls_root/cert.pem" ARKME_E2E_TLS_KEY="$task_tls_root/key.pem"
export ARKME_PLUGIN_CHECKOUT="$task_plugin_root" JOTMO_MANAGED_AI_BROWSER_E2E=1
cd "$JOTMO_INTELLIGENT_CHECKOUT"
go test ./internal/managedai/runtime -run '^TestManagedAIPluginBrowserChain$' -count=1 -v -timeout=5m
