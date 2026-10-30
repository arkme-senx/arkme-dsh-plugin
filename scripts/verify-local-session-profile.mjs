// Run after build: node scripts/verify-local-session-profile.mjs <Harness root>
import assert from 'node:assert/strict'
import { readFile, realpath } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { resolve, join } from 'node:path'
import { pathToFileURL } from 'node:url'

const root = process.cwd()
const harness = createRequire(await realpath(join(resolve(process.argv[2]), 'node_modules/@deepseek-ai/dsh/package.json')))
const upstream = createRequire(harness.resolve('@deepseek-ai/dsh-base/package.json'))
const local = createRequire(join(root, 'package.json'))
const manifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
const hostDir = join(root, 'lib/local-session')
const browserDir = join(hostDir, 'gateway-browser')
const host = JSON.parse(await readFile(join(hostDir, 'package.json'), 'utf8'))
const browser = JSON.parse(await readFile(join(browserDir, 'package.json'), 'utf8'))
assert.equal(host.name, `${manifest.name}-local-session`)
assert.equal(host.version, manifest.version)
assert.equal(host.dsh?.client, undefined)
assert.equal(browser.name, '@deepseek-ai/dsh-api-gateway')
assert.equal(browser.arkme.browserOnlyCarrier, true)
assert.deepEqual(await readFile(join(browserDir, 'client.js')), await readFile(local.resolve('@deepseek-ai/dsh-api-gateway/client')))
assert.equal(await readFile(join(browserDir, 'index.js'), 'utf8'), 'export function apply() {}\n')

// Exercise the published upstream extension, not a reimplementation of its
// manifest rules. ACTIVE=2 is the pinned Cordis enum's emitted runtime value.
const inventory = await import(pathToFileURL(upstream.resolve('@deepseek-ai/dsh-plugin-package-inventory-deepseek')))
let provider
const tree = { ctx: { baseUrl: pathToFileURL(join(root, 'cordis.patch.yml')).href } }
const entries = ['lib/index.js', 'lib/local-session/index.js', 'lib/local-session/gateway-browser/index.js']
inventory.apply({
  baseUrl: tree.ctx.baseUrl,
  loader: { entries: () => entries.map(name => ({ options: { name: pathToFileURL(join(root, name)).href }, fiber: { state: 2 }, parent: { tree } })) },
  get: () => undefined,
  deepseekLlmApiExtensions: { register: (_name, value) => { provider = value } },
}, {})
const result = await provider.prepare({ signal: new AbortController().signal })
assert.deepEqual(result.value.packages, [
  { name: browser.name, version: browser.version },
  { name: manifest.name, version: manifest.version },
  { name: host.name, version: host.version },
])
console.log(JSON.stringify({ hostIdentity: true, browserIdentity: true, originalBrowserBytes: true, deepseekRequestInventory: true }))
