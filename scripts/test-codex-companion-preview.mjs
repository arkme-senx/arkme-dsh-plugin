import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, isAbsolute, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const args = process.argv.slice(2)
assert.equal(process.platform, 'darwin', 'Native diagnostic smoke checks require macOS')
assert.equal(args.length, 2)
assert.equal(args[0], '--app')
assert.ok(isAbsolute(args[1]))
const app = args[1]
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const binary = join(app, 'Contents/MacOS/ArkmeCodexCompanion')
function run(command, commandArgs) {
  const result = spawnSync(command, commandArgs, { encoding: 'utf8', timeout: 15_000, maxBuffer: 128 * 1024 })
  if (result.error) throw result.error
  return result
}

assert.equal(run('/usr/bin/codesign', ['--verify', '--strict', app]).status, 0)
assert.equal(run('/usr/bin/plutil', ['-lint', join(app, 'Contents/Info.plist')]).status, 0)
const testFolder = mkdtempSync(join(tmpdir(), 'arkme-permission-guide-test-'))
const testBinary = join(testFolder, 'permission-guide-tests')
const compiled = run('/usr/bin/xcrun', ['swiftc', '-warnings-as-errors',
  join(root, 'tools/codex-companion/PermissionGuide.swift'),
  join(root, 'tools/codex-companion/tests/main.swift'), '-o', testBinary])
assert.equal(compiled.status, 0, compiled.stderr)
const tests = run(testBinary, [])
assert.equal(tests.status, 0, tests.stderr)
process.stdout.write(tests.stdout)
const probe = run(binary, ['doctor'])
assert.equal(probe.status, 0, probe.stderr)
const report = JSON.parse(probe.stdout)
assert.equal(report.schemaVersion, 1)
assert.equal(report.mode, 'read-only-doctor')
assert.equal(report.nativeQueueSubmissionVerified, false)
assert.ok(report.blockers.includes('native_submission_adapter_not_validated'))
assert.equal(typeof report.accessibilityTrusted, 'boolean')
assert.ok(Number.isInteger(report.appProcessCount))
assert.equal(report.appBundleID, 'com.openai.codex')
assert.ok(Number.isFinite(Date.parse(report.checkedAt)))
assert.ok(report.windows.length <= 5)
if (!report.accessibilityTrusted) {
  assert.ok(report.blockers.includes('accessibility_permission_required'))
  assert.deepEqual(report.windows, [])
}
const allowedRoot = new Set(['schemaVersion', 'mode', 'checkedAt', 'accessibilityTrusted', 'screenLocked',
  'appBundleID', 'appVersion', 'appProcessCount', 'windowCount', 'windows', 'blockers', 'nativeQueueSubmissionVerified'])
assert.ok(Object.keys(report).every(key => allowedRoot.has(key)))
for (const window of report.windows) {
  assert.ok(window.nodesVisited <= 2000)
  for (const editor of window.editors) {
    assert.ok(Object.keys(editor).every(key => ['attributes', 'description', 'placeholder', 'valueLength', 'valueSettable'].includes(key)))
    assert.ok(!Object.hasOwn(editor, 'value'), 'Never export draft text')
  }
}
// Unsupported operations cannot accidentally start a UI sender or launch a service.
const rejectedCommands = [['send', 'not-a-real-request'], ['queue'], ['install'], ['doctor', '--send'],
  ['native-test', '00000000-0000-0000-0000-000000000000', 'idle', '/tmp/not-created.json'],
  ['native-test', '01a0f330-ac7b-7893-a977-f18dd8ea8abf', 'arbitrary-text', '/tmp/not-created.json'],
  ['native-test', '01a0f330-ac7b-7893-a977-f18dd8ea8abf', 'idle', 'relative.json']]
for (const commandArgs of rejectedCommands) {
  const result = run(binary, commandArgs)
  assert.equal(result.status, 64)
  assert.equal(result.stdout, '')
}
console.log(`PASS: bundle signature/plist, native read-only probe, no false delivery success, bounded/redacted report, ${rejectedCommands.length} unsupported command guards.`)
console.log('This is not an input, queue or cross-computer end-to-end test.')
