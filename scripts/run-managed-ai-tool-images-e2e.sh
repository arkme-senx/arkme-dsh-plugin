#!/usr/bin/env bash
set -euo pipefail
task_plugin_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
: "${ARKME_DSH_CHECKOUT:?Set the unmodified target Harness checkout}"
: "${ARKME_PACKED_PROFILE:?Install the immutable plugin tgz in a fresh profile first}"
: "${JOTMO_INTELLIGENT_CHECKOUT:?Set the Intelligent checkout}"
: "${MANAGED_AI_TEST_MYSQL_ADDR:?Set isolated loopback MySQL host:port}"
test -z "$(git -C "$ARKME_DSH_CHECKOUT" status --porcelain --untracked-files=no)"
task_test_root="$(mktemp -d "${TMPDIR:-/tmp}/arkme-tool-images.XXXXXX")"
trap 'rm -f "$task_test_root/key.pem" "$task_test_root/cert.pem" "$task_test_root/overlay.json"; rmdir "$task_test_root"' EXIT
openssl req -x509 -newkey rsa:2048 -nodes -days 1 -subj '/CN=localhost' \
  -addext 'subjectAltName=IP:127.0.0.1' -keyout "$task_test_root/key.pem" -out "$task_test_root/cert.pem" >/dev/null 2>&1
chmod 600 "$task_test_root/key.pem"
export NODE_EXTRA_CA_CERTS="$task_test_root/cert.pem" ARKME_E2E_TLS_KEY="$task_test_root/key.pem"
export ARKME_PLUGIN_CHECKOUT="$task_plugin_root" ARKME_MANAGED_AI_TOOL_IMAGES=1
# Compile the plugin-owned integration fixture beside existing backend helpers;
# Go's overlay is read-only for the backend checkout, including during failure.
node --input-type=module - "$JOTMO_INTELLIGENT_CHECKOUT" "$task_plugin_root" "$task_test_root/overlay.json" <<'JS'
import { writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
const [backend, plugin, output] = process.argv.slice(2)
writeFileSync(output, JSON.stringify({ Replace: {
  [resolve(backend, 'internal/managedai/runtime/plugin_tool_images_test.go')]: resolve(plugin, 'tests/fixtures/managed-ai/tool_images_backend_test.go'),
} }))
JS
cd "$JOTMO_INTELLIGENT_CHECKOUT"
go test -overlay "$task_test_root/overlay.json" ./internal/managedai/runtime -run '^TestManagedAIToolImagesBrowserChain$' -count=1 -v -timeout=5m
