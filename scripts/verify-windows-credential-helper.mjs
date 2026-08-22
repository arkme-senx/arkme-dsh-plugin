import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { windowsCredentialHelperSourceSha256 } from './windows-credential-helper-sources.mjs'

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const assetDirectory = resolve(process.argv[2] ?? join(projectRoot, 'assets', 'windows'))

async function verify() {
  const manifestPath = join(assetDirectory, 'manifest.json')
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
  if (
    manifest?.schemaVersion !== 1
    || manifest?.platform !== 'win32'
    || manifest?.arch !== 'x64'
    || manifest?.file !== 'arkme-credential-helper.exe'
    || !/^[a-f0-9]{64}$/.test(manifest?.sha256)
    || !/^[a-f0-9]{64}$/.test(manifest?.sourceSha256)
    || typeof manifest?.goVersion !== 'string'
    || !manifest.goVersion.startsWith('go version go')
  ) {
    throw new Error('Windows credential helper manifest is invalid')
  }

  const helper = await readFile(join(assetDirectory, manifest.file))
  const actualHash = createHash('sha256').update(helper).digest('hex')
  if (actualHash !== manifest.sha256) {
    throw new Error(`Windows credential helper checksum mismatch: expected ${manifest.sha256}, received ${actualHash}`)
  }
  const actualSourceHash = await windowsCredentialHelperSourceSha256(projectRoot)
  if (actualSourceHash !== manifest.sourceSha256) {
    throw new Error(`Windows credential helper source checksum mismatch: expected ${manifest.sourceSha256}, received ${actualSourceHash}`)
  }
  process.stdout.write(`Verified ${manifest.file} (${actualHash})\n`)
}

try {
  await verify()
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
  process.exitCode = 1
}
