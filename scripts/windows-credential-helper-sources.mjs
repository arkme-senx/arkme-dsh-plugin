import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

const helperSourceFiles = [
  'native/windows-credential-helper/go.mod',
  'native/windows-credential-helper/main_unsupported.go',
  'native/windows-credential-helper/main_windows.go',
  'native/windows-credential-helper/protocol/protocol.go',
  'scripts/build-windows-credential-helper.mjs',
  'scripts/windows-credential-helper-sources.mjs',
]

export async function windowsCredentialHelperSourceSha256(projectRoot) {
  const hash = createHash('sha256')
  for (const relativePath of helperSourceFiles) {
    hash.update(relativePath, 'utf8')
    hash.update('\0')
    hash.update(await readFile(join(projectRoot, relativePath)))
    hash.update('\0')
  }
  return hash.digest('hex')
}
