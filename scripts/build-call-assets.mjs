import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
const root = join(dirname(fileURLToPath(import.meta.url)), '..')
execFileSync('npm', ['run', 'build'], { cwd: join(root, 'tools/desktop-call'), stdio: 'inherit' })
const sha = async path => createHash('sha256').update(await readFile(join(root, path))).digest('hex')
const path = join(root, 'assets/desktop_call/manifest.json')
const manifest = JSON.parse(await readFile(path, 'utf8'))
manifest.bundleSha256 = await sha('assets/desktop_call/bundle.js')
manifest.localSource = 'tools/desktop-call/src/index.js'
manifest.localSourceSha256 = await sha(manifest.localSource)
manifest.imBridgeSha256 = await sha('tools/desktop-call/src/im-bridge.js')
manifest.buildLockSha256 = await sha('tools/desktop-call/package-lock.json')
await writeFile(path, JSON.stringify(manifest, null, 2) + '\n')
const htmlPath = join(root, 'assets/desktop_call/index.html')
const html = await readFile(htmlPath, 'utf8')
await writeFile(htmlPath, html.replace(/bundle\.js\?v=[a-f0-9]+/g, `bundle.js?v=${manifest.bundleSha256}`))
