import { spawnSync } from 'node:child_process'
import { chmodSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

// Produces a standalone development app; never installs it or changes login items,
// system permissions, the Arkme preview, Codex data or the installed applications.
const args = process.argv.slice(2)
if (process.platform !== 'darwin' || args.length !== 2 || args[0] !== '--out' || !isAbsolute(args[1])) {
  throw new Error('macOS only. Usage: node scripts/build-codex-companion-preview.mjs --out /absolute/new-directory')
}
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const out = resolve(args[1])
// Fail on an existing target; never overwrite an app the user may have authorized.
mkdirSync(out, { mode: 0o700 })
const app = join(out, 'Arkme Codex Companion Preview.app')
const contents = join(app, 'Contents')
const macOS = join(contents, 'MacOS')
mkdirSync(macOS, { recursive: true })
const binary = join(macOS, 'ArkmeCodexCompanion')
function run(command, commandArgs) {
  const result = spawnSync(command, commandArgs, { stdio: 'inherit', timeout: 120_000 })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`${command} failed (${result.status})`)
}
run('/usr/bin/xcrun', ['swiftc', '-warnings-as-errors',
  join(root, 'tools/codex-companion/Doctor.swift'), join(root, 'tools/codex-companion/PermissionGuide.swift'),
  join(root, 'tools/codex-companion/NativeInput.swift'), join(root, 'tools/codex-companion/NativeValidation.swift'),
  join(root, 'tools/codex-companion/main.swift'), '-o', binary])
chmodSync(binary, 0o755)
writeFileSync(join(contents, 'Info.plist'), `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleIdentifier</key><string>cc.arkme.codex-companion.preview</string>
<key>CFBundleName</key><string>Arkme Codex Companion Preview</string>
<key>CFBundleDisplayName</key><string>Arkme Codex 连接助手（验证版）</string>
<key>CFBundleExecutable</key><string>ArkmeCodexCompanion</string>
<key>CFBundlePackageType</key><string>APPL</string>
<key>CFBundleShortVersionString</key><string>0.0.3</string>
<key>CFBundleVersion</key><string>3</string>
<key>LSMinimumSystemVersion</key><string>13.0</string>
<key>LSUIElement</key><true/>
<key>NSHighResolutionCapable</key><true/>
</dict></plist>
`)
run('/usr/bin/plutil', ['-lint', join(contents, 'Info.plist')])
run('/usr/bin/codesign', ['--sign', '-', '--identifier', 'cc.arkme.codex-companion.preview', app])
run('/usr/bin/codesign', ['--verify', '--strict', app])
console.log(`Built preview with explicit dedicated native tests (not installed or launched): ${app}`)
