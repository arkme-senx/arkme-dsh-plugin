import { createHash } from 'node:crypto'
import { existsSync, readFileSync, realpathSync, statSync } from 'node:fs'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import type { ArkmeOwnedExtensionStore } from './owned-store.js'
import { ArkmeBundleArtifactError, packLocalBundleDirectory, readLocalBundleTarball } from './bundle-artifact.js'
import type { ArkmeOwnedProfileTarget } from './owned-refs.js'

export interface OwnedProfileExtension {
  sourceKey: string
  packageName: string
  version?: string
  name: string
  description: string
  active: boolean
  halves: { host: boolean; client: boolean }
  extensionId?: string
  publishable: boolean
  publishReason?: string
  target?: ArkmeOwnedProfileTarget
}

export interface OwnedProfileInventoryResult {
  items: OwnedProfileExtension[]
  invalidEntries: number
}

interface PackageManifest {
  name?: unknown
  version?: unknown
  description?: unknown
  dsh?: {
    bundle?: { patch?: unknown }
    client?: unknown
  }
}

/** Read account-owned local Bundle dependencies without enumerating installation-owned DSH bundles. */
export function scanOwnedProfileExtensions(input: {
  profileDirectory: string
  profileName: string
  userId: number
  cloudOwnedExtensionIds: ReadonlySet<string>
  store: ArkmeOwnedExtensionStore
}): OwnedProfileInventoryResult {
  const profileManifest = readJson(join(input.profileDirectory, 'package.json')) as {
    dependencies?: Record<string, unknown>
    dsh?: { profile?: { bundles?: unknown } }
  } | undefined
  if (profileManifest === undefined) return { items: [], invalidEntries: 1 }
  const dependencies = profileManifest.dependencies ?? {}
  const bundles = new Set(Array.isArray(profileManifest.dsh?.profile?.bundles)
    ? profileManifest.dsh.profile.bundles.filter((value): value is string => typeof value === 'string')
    : [])
  const items: OwnedProfileExtension[] = []
  let invalidEntries = 0
  for (const [packageName, rawSpec] of Object.entries(dependencies)) {
    if (packageName.startsWith('@deepseek-ai/') || packageName === '@senguoyun/dsh-arkme') continue
    if (typeof rawSpec !== 'string' || (!rawSpec.startsWith('link:') && !rawSpec.startsWith('file:'))) continue
    try {
      const localSource = resolveLocalSource(input.profileDirectory, rawSpec)
      if (localSource === undefined) continue
      const manifest = localSource.kind === 'profile-directory'
        ? readJson(join(localSource.path, 'package.json')) as PackageManifest | undefined
        : undefined
      if (localSource.kind === 'profile-directory') {
        if (manifest?.name !== packageName || typeof manifest.dsh?.bundle?.patch !== 'string') throw new Error('manifest invalid')
        const patchPath = realpathSync(join(localSource.path, manifest.dsh.bundle.patch))
        if (!isInside(localSource.path, patchPath) || !statSync(patchPath).isFile()) throw new Error('patch invalid')
      }
      const sourceKey = `${input.profileName}\0${packageName}`
      const extensionId = packageName.startsWith('@arkme-local/ext-') && localSource.kind === 'profile-directory'
	    ? extensionIdFromInstallation(localSource.path)
	    : undefined
      if (packageName.startsWith('@arkme-local/ext-')
        && (extensionId === undefined || !input.cloudOwnedExtensionIds.has(extensionId))) continue
      const owner = input.store.owner('profile', sourceKey)
      if (owner !== undefined && owner !== input.userId) continue
      const specDigest = createHash('sha256').update(rawSpec).digest('hex')
      input.store.claim('profile', sourceKey, input.userId, specDigest)
      let publishable = !packageName.startsWith('@arkme-local/ext-')
      let publishReason: string | undefined
      let version = typeof manifest?.version === 'string' && manifest.version.trim() !== '' ? manifest.version : undefined
      if (publishable) {
        try {
          const source = localSource.kind === 'profile-directory'
            ? packLocalBundleDirectory(localSource.path)
            : readLocalBundleTarball(localSource.path)
          if (source.bundle.packageName !== packageName) throw new Error('package name mismatch')
          version = source.bundle.version
        } catch (error) {
          publishable = false
          publishReason = error instanceof ArkmeBundleArtifactError ? error.code : 'bundle-validation-failed'
        }
      } else {
        publishReason = 'market-installation'
      }
      items.push({
        sourceKey,
        packageName,
	    ...(version === undefined ? {} : { version }),
        name: packageName,
	    description: typeof manifest?.description === 'string' ? manifest.description : '',
        active: bundles.has(packageName),
	    halves: { host: true, client: manifest?.dsh?.client !== undefined },
	    publishable,
	    ...(publishReason === undefined ? {} : { publishReason }),
	    ...(publishable ? {
	      target: {
	        kind: localSource.kind,
	        sourceKey,
	        packageName,
	        sourcePath: localSource.path,
	        specDigest,
	      },
	    } : {}),
        ...(extensionId === undefined ? {} : { extensionId }),
      })
    } catch {
      invalidEntries += 1
    }
  }
  return { items, invalidEntries }
}

function resolveLocalSource(
  profileDirectory: string,
  spec: string,
): { kind: 'profile-directory' | 'profile-tarball'; path: string } | undefined {
  const raw = spec.slice(spec.indexOf(':') + 1)
  if (raw === '') throw new Error('empty local spec')
  const target = isAbsolute(raw) ? raw : resolve(profileDirectory, raw)
  if (!existsSync(target)) throw new Error('local spec does not exist')
  if (!statSync(target).isDirectory()) {
	if (spec.startsWith('file:') && statSync(target).isFile() && target.toLowerCase().endsWith('.tgz')) {
	  return { kind: 'profile-tarball', path: realpathSync(target) }
	}
	throw new Error('local spec is not a directory')
  }
  return { kind: 'profile-directory', path: realpathSync(target) }
}

function extensionIdFromInstallation(packageDirectory: string): string | undefined {
  const installation = readJson(join(packageDirectory, 'installation.json')) as { extension_id?: unknown } | undefined
  const extensionId = installation?.extension_id
  return typeof extensionId === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(extensionId) ? extensionId : undefined
}

function isInside(root: string, target: string): boolean {
  const pathFromRoot = relative(realpathSync(root), target)
  return pathFromRoot !== '' && !pathFromRoot.startsWith('..') && !isAbsolute(pathFromRoot)
}

function readJson(path: string): unknown {
  try { return JSON.parse(readFileSync(path, 'utf8')) as unknown } catch { return undefined }
}
