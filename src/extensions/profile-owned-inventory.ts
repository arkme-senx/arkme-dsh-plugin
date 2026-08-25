import { createHash } from 'node:crypto'
import { existsSync, readFileSync, realpathSync, statSync } from 'node:fs'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import type { ArkmeOwnedExtensionStore } from './owned-store.js'
import {
  ArkmeBundleArtifactError, packLocalBundleDirectory, packLocalNativeBundleDirectoryV3,
  inspectBundleArtifact, readLocalBundleTarball, readNativeBundleTarballV3,
} from './bundle-artifact.js'
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
  artifactContractVersion?: 2 | 3
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
    arkme?: { executionModel?: unknown; runtimeContract?: unknown }
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
    if (typeof rawSpec !== 'string') continue
    try {
      const localSource = rawSpec.startsWith('link:') || rawSpec.startsWith('file:')
        ? resolveLocalSource(input.profileDirectory, rawSpec)
        : resolveInstalledSource(input.profileDirectory, packageName)
      if (localSource === undefined) continue
      const manifest = localSource.kind === 'profile-directory' || localSource.kind === 'profile-installed'
        ? readJson(join(localSource.path, 'package.json')) as PackageManifest | undefined
        : undefined
      if (localSource.kind === 'profile-directory' || localSource.kind === 'profile-installed') {
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
      let artifactContractVersion: 2 | 3 = 3
      let version = typeof manifest?.version === 'string' && manifest.version.trim() !== '' ? manifest.version : undefined
      let displayName = packageName
      let displayDescription = typeof manifest?.description === 'string' ? manifest.description : ''
      if (publishable) {
        try {
          const source = readProfileSource(localSource, manifest)
          if (source.bundle.packageName !== packageName) throw new Error('package name mismatch')
          version = source.bundle.version
          artifactContractVersion = source.artifactContractVersion
          displayName = source.displayName ?? displayName
          displayDescription = source.displayDescription ?? displayDescription
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
        name: displayName,
	    description: displayDescription,
	    active: bundles.has(packageName),
	    halves: { host: true, client: manifest?.dsh?.client !== undefined },
	    artifactContractVersion,
	    publishable,
	    ...(publishReason === undefined ? {} : { publishReason }),
	    ...(publishable ? {
	      target: {
	        kind: localSource.kind,
	        sourceKey,
	        packageName,
	        sourcePath: localSource.path,
	        specDigest,
	        artifactContractVersion,
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

function readProfileSource(
  source: { kind: 'profile-directory' | 'profile-tarball' | 'profile-installed'; path: string },
  manifest: PackageManifest | undefined,
): {
  artifactContractVersion: 2 | 3
  bundle: { packageName: string; version: string }
  displayName?: string
  displayDescription?: string
} {
  if (source.kind !== 'profile-tarball') {
    if (manifest?.dsh?.arkme?.executionModel === 'arkme-sandboxed') {
      const packed = packLocalBundleDirectory(source.path)
      return { artifactContractVersion: 2, bundle: packed.bundle, ...sandboxDisplayMetadata(packed.bundle.bytes) }
    }
    return { artifactContractVersion: 3, bundle: packLocalNativeBundleDirectoryV3(source.path).bundle }
  }
  try {
    const sandbox = readLocalBundleTarball(source.path)
    if (sandbox.bundle.executionModel !== 'arkme-sandboxed') throw new Error('not a sandbox Bundle')
    return { artifactContractVersion: 2, bundle: sandbox.bundle, ...sandboxDisplayMetadata(sandbox.bundle.bytes) }
  } catch (sandboxError) {
    try {
      return { artifactContractVersion: 3, bundle: readNativeBundleTarballV3(source.path).bundle }
    } catch {
      throw sandboxError
    }
  }
}

function sandboxDisplayMetadata(bytes: Uint8Array): { displayName?: string; displayDescription?: string } {
  const raw = inspectBundleArtifact(bytes).files.get('package/arkme/source.json')
  if (raw === undefined) return {}
  let source: unknown
  try { source = JSON.parse(raw.toString('utf8')) as unknown } catch { return {} }
  if (source === null || typeof source !== 'object' || Array.isArray(source)) return {}
  const record = source as Record<string, unknown>
  const name = typeof record.name === 'string' ? record.name.replace(/[\u0000-\u001F\u007F]/g, ' ').trim().slice(0, 120) : ''
  const description = typeof record.description === 'string'
    ? record.description.replace(/[\u0000-\u001F\u007F]/g, ' ').trim().slice(0, 2_000)
    : ''
  return {
    ...(name === '' ? {} : { displayName: name }),
    ...(description === '' ? {} : { displayDescription: description }),
  }
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

function resolveInstalledSource(
  profileDirectory: string,
  packageName: string,
): { kind: 'profile-installed'; path: string } | undefined {
  const target = join(profileDirectory, 'node_modules', ...packageName.split('/'))
  if (!existsSync(target) || !statSync(target).isDirectory()) return undefined
  return { kind: 'profile-installed', path: realpathSync(target) }
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
