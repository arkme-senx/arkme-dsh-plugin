import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const expectedVersion = readFileSync(join(root, '.dsh-development-version'), 'utf8').trim()

if (typeof expectedVersion !== 'string' || !/^0\.1\.1(?:-|$)/.test(expectedVersion)) {
  throw new Error(`Expected an exact DSH 0.1.1 development version, received ${String(expectedVersion)}`)
}

const manifestMismatches = Object.entries(manifest.devDependencies ?? {})
  .filter(([name]) => name.startsWith('@deepseek-ai/dsh-'))
  .filter(([, version]) => version !== expectedVersion)

if (manifestMismatches.length > 0) {
  throw new Error(`DSH devDependencies must match ${expectedVersion}: ${JSON.stringify(manifestMismatches)}`)
}

const expectedPeerRange = `^${expectedVersion}`
const peerMismatches = Object.entries(manifest.peerDependencies ?? {})
  .filter(([name]) => name.startsWith('@deepseek-ai/dsh-'))
  .filter(([, version]) => version !== expectedPeerRange)

if (peerMismatches.length > 0) {
  throw new Error(`DSH peerDependencies must match ${expectedPeerRange}: ${JSON.stringify(peerMismatches)}`)
}

const lockfile = readFileSync(join(root, 'pnpm-lock.yaml'), 'utf8')
const lockedVersions = new Set(
  [...lockfile.matchAll(/@deepseek-ai\/dsh(?:-[a-z0-9-]+)?@(\d+\.\d+\.\d+(?:-[0-9a-z.-]+)?)/gi)]
    .map((match) => match[1]),
)
const unexpectedLockedVersions = [...lockedVersions].filter((version) => version !== expectedVersion)

if (unexpectedLockedVersions.length > 0) {
  throw new Error(`pnpm-lock.yaml contains DSH versions outside ${expectedVersion}: ${unexpectedLockedVersions.join(', ')}`)
}

const scopeRoot = join(root, 'node_modules', '@deepseek-ai')
const installedMismatches = readdirSync(scopeRoot)
  .filter((directory) => directory.startsWith('dsh-'))
  .map((directory) => {
    const packageManifest = JSON.parse(readFileSync(join(scopeRoot, directory, 'package.json'), 'utf8'))
    return [packageManifest.name, packageManifest.version]
  })
  .filter(([, version]) => version !== expectedVersion)

if (installedMismatches.length > 0) {
  throw new Error(`Installed DSH packages must match ${expectedVersion}: ${JSON.stringify(installedMismatches)}`)
}

console.log(`Verified plugin development uses DSH ${expectedVersion}`)
