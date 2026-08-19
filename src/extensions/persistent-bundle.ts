import { createHash, randomUUID } from 'node:crypto'
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { ArkmeExtensionInstallResolution } from './types.js'
import { renderPersistentClientBundle } from './persistent-client-bundle.js'

export const ARKME_PERSISTENT_BUNDLE_FORMAT_VERSION = 1 as const

export interface ArkmePersistentBundleResult {
  packageName: string
  bundleDirectory: string
  installationPath: string
}

export interface ArkmePersistentInstallation {
  format_version: typeof ARKME_PERSISTENT_BUNDLE_FORMAT_VERSION
  extension_id: string
  version: string
  artifact_path: string
  artifact_sha256: string
  manifest_sha256: string
  signature: string
  signing_key_id: string
  trusted_public_key: string
  published_at: number
}

function packageIdentity(extensionId: string): { packageName: string; entryId: string } {
  const suffix = createHash('sha256').update(extensionId).digest('hex').slice(0, 16)
  return { packageName: `@arkme-local/ext-${suffix}`, entryId: `arkme-extension-${suffix}` }
}

function writeSecure(path: string, content: string): void {
  writeFileSync(path, content, { encoding: 'utf8', mode: 0o600, flag: 'wx' })
  chmodSync(path, 0o600)
}

export function materializePersistentExtensionBundle(input: {
  profileDirectory: string
  resolution: ArkmeExtensionInstallResolution
  artifactPath: string
  trustedPublicKey: string
  clientCode?: string
  clientApiPath?: string
}): ArkmePersistentBundleResult {
  const { packageName, entryId } = packageIdentity(input.resolution.extension_id)
  const bundleDirectory = join(
    input.profileDirectory,
    'arkme-extensions',
    createHash('sha256').update(input.resolution.extension_id).digest('hex').slice(0, 16),
    input.resolution.version,
  )
  const installation: ArkmePersistentInstallation = {
    format_version: ARKME_PERSISTENT_BUNDLE_FORMAT_VERSION,
    extension_id: input.resolution.extension_id,
    version: input.resolution.version,
    artifact_path: input.artifactPath,
    artifact_sha256: input.resolution.artifact_sha256,
    manifest_sha256: input.resolution.manifest_sha256,
    signature: input.resolution.signature,
    signing_key_id: input.resolution.signing_key_id,
    trusted_public_key: input.trustedPublicKey,
    published_at: input.resolution.published_at,
  }
  const installationText = `${JSON.stringify(installation, undefined, 2)}\n`
  const installationPath = join(bundleDirectory, 'installation.json')
  if (existsSync(bundleDirectory)) {
    let existing: Partial<ArkmePersistentInstallation> | undefined
    try {
      existing = JSON.parse(readFileSync(installationPath, 'utf8')) as Partial<ArkmePersistentInstallation>
    } catch { /* An incomplete old directory is replaced below. */ }
    if (existing !== undefined) {
      if (existing.artifact_sha256 === installation.artifact_sha256 && existing.version === installation.version) {
        try {
          const manifest = JSON.parse(readFileSync(join(bundleDirectory, 'package.json'), 'utf8')) as {
            exports?: Record<string, string>
            dsh?: { client?: { inject?: string[] } }
          }
          const clientReady = input.clientCode === undefined || (
            manifest.exports?.['./client'] === './lib/client.js'
            && manifest.dsh?.client?.inject?.length === 0
            && readFileSync(join(bundleDirectory, 'lib', 'client.js'), 'utf8').includes('extensions.persistent.invoke')
          )
          if (manifest.exports?.['.'] === './lib/index.js'
            && manifest.exports?.['./package.json'] === './package.json' && clientReady) {
            return { packageName, bundleDirectory, installationPath }
          }
        } catch { /* Regenerate an incomplete wrapper from the same immutable artifact. */ }
        rmSync(bundleDirectory, { recursive: true, force: true })
      } else {
        throw new Error('同一扩展版本已经存在不同的本地 Bundle，拒绝覆盖不可变版本')
      }
    }
    if (existsSync(bundleDirectory)) rmSync(bundleDirectory, { recursive: true, force: true })
  }
  mkdirSync(dirname(bundleDirectory), { recursive: true, mode: 0o700 })
  const temporary = `${bundleDirectory}.tmp-${randomUUID()}`
  mkdirSync(join(temporary, 'lib'), { recursive: true, mode: 0o700 })
  const manifest = {
    name: packageName,
    version: input.resolution.version,
    private: true,
    type: 'module',
    main: './lib/index.js',
    exports: {
      '.': './lib/index.js',
      ...(input.clientCode === undefined ? {} : { './client': './lib/client.js' }),
      './package.json': './package.json',
    },
    dsh: {
      bundle: { patch: './cordis.patch.yml' },
      ...(input.clientCode === undefined ? {} : {
        client: {
          inject: [],
          platform: 'web',
        },
      }),
    },
  }
  writeSecure(join(temporary, 'package.json'), `${JSON.stringify(manifest, undefined, 2)}\n`)
  writeSecure(join(temporary, 'cordis.patch.yml'), `- insert:\n    - id: ${entryId}\n      name: '${packageName}'\n`)
  writeSecure(join(temporary, 'installation.json'), installationText)
  writeSecure(join(temporary, 'lib', 'index.js'), [
    `import { applyPersistentArkmeHostExtension } from '@senguoyun/dsh-arkme/persistent-extension'`,
    `export const name = ${JSON.stringify(entryId)}`,
    `export async function apply(ctx) {`,
    `  await applyPersistentArkmeHostExtension(ctx, new URL('../installation.json', import.meta.url))`,
    `}`,
    '',
  ].join('\n'))
  if (input.clientCode !== undefined) {
    writeSecure(join(temporary, 'lib', 'client.js'), renderPersistentClientBundle(packageName, {
      extensionId: input.resolution.extension_id,
      version: input.resolution.version,
      name: input.resolution.manifest.name,
      code: input.clientCode,
      apiPath: input.clientApiPath ?? '/arkme-self/api',
    }))
  }
  renameSync(temporary, bundleDirectory)
  return { packageName, bundleDirectory, installationPath }
}
