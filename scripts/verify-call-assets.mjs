import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..', 'assets', 'desktop_call')
const manifest = JSON.parse(await readFile(join(root, 'manifest.json'), 'utf8'))

async function verify(name, expected) {
  const value = createHash('sha256').update(await readFile(join(root, name))).digest('hex')
  if (value !== expected) throw new Error(`${name} checksum mismatch: expected ${expected}, got ${value}`)
}

await verify('bundle.js', manifest.bundleSha256)
await verify('call-linear-strong.svg', manifest.iconSha256)
if (manifest.outgoingOnly !== true) throw new Error('desktop call assets must remain outgoing-only')
console.log('desktop call assets verified')
