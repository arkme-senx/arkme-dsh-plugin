import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const root = new URL('../', import.meta.url)
const require = createRequire(new URL('package.json', root))
const plugin = JSON.parse(await readFile(new URL('package.json', root), 'utf8'))
const gateway = JSON.parse(await readFile(require.resolve('@deepseek-ai/dsh-api-gateway/package.json'), 'utf8'))
if (gateway.version !== '0.1.5-rc.2') throw new Error('Local session Profile requires DSH Gateway 0.1.5-rc.2')
const directory = new URL('lib/local-session/', root)
const browser = new URL('gateway-browser/', directory)
await mkdir(browser, { recursive: true })
// A separate manifest prevents the host entry from registering Arkme's UI again.
await writeFile(new URL('package.json', directory), JSON.stringify({
  name: `${plugin.name}-local-session`, version: plugin.version, type: 'module',
  main: './index.js', private: true,
}, null, 2) + '\n')
// This carrier provides only the unchanged official browser face. The custom
// host service belongs to the Arkme package above, never to this identity.
await writeFile(new URL('package.json', browser), JSON.stringify({
  name: gateway.name, version: gateway.version, license: gateway.license,
  type: 'module', main: './index.js',
  exports: { '.': './index.js', './client': './client.js' },
  dsh: { client: gateway.dsh.client },
  arkme: { browserOnlyCarrier: true, source: `${gateway.name}@${gateway.version}` },
}, null, 2) + '\n')
await writeFile(new URL('index.js', browser), 'export function apply() {}\n')
await writeFile(new URL('client.js', browser), await readFile(require.resolve('@deepseek-ai/dsh-api-gateway/client')))
console.log(`Built local session Profile: ${fileURLToPath(directory)}`)
