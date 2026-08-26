import { createHash } from 'node:crypto'
import { existsSync, readFileSync, realpathSync, statSync } from 'node:fs'
import { isAbsolute, join, resolve } from 'node:path'

const PACKAGE_NAME = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/

export function arkmeClientOwnerKey(code: string): string {
  return `client-v1-${createHash('sha256').update(code.replace(/\r\n?/g, '\n')).digest('hex')}`
}

export function arkmeClientOwnerKeyFromSource(files: ReadonlyMap<string, Buffer>): string | undefined {
  const source = files.get('package/arkme/source.json')
  if (source === undefined) return undefined
  try {
    const value = JSON.parse(source.toString('utf8')) as { clientCode?: unknown }
    return typeof value.clientCode === 'string' ? arkmeClientOwnerKey(value.clientCode) : undefined
  } catch {
    return undefined
  }
}

export function activeProfileClientOwnerConflicts(input: {
  profileDirectory: string
  ownerKey: string
  packageName: string
  managedPackageNames?: ReadonlySet<string>
}): string[] {
  let profile: {
    dependencies?: Record<string, unknown>
    dsh?: { profile?: { bundles?: unknown } }
  }
  try {
    profile = JSON.parse(readFileSync(join(input.profileDirectory, 'package.json'), 'utf8')) as typeof profile
  } catch {
    return []
  }
  const active = Array.isArray(profile.dsh?.profile?.bundles)
    ? profile.dsh.profile.bundles.filter((value): value is string => typeof value === 'string')
    : []
  const conflicts = new Set<string>()
  for (const packageName of active) {
    if (packageName === input.packageName || input.managedPackageNames?.has(packageName) === true
      || !PACKAGE_NAME.test(packageName) || packageName.startsWith('@deepseek-ai/')
      || packageName === '@senguoyun/dsh-arkme') continue
    const rawSpec = profile.dependencies?.[packageName]
    if (typeof rawSpec !== 'string') continue
    const directory = resolvePackageDirectory(input.profileDirectory, packageName, rawSpec)
    if (directory === undefined) continue
    const ownerKey = readPackageOwnerKey(directory)
    if (ownerKey === input.ownerKey) conflicts.add(packageName)
  }
  return [...conflicts].sort()
}

function resolvePackageDirectory(profileDirectory: string, packageName: string, spec: string): string | undefined {
  try {
    if (spec.startsWith('link:') || spec.startsWith('file:')) {
      const raw = spec.slice(spec.indexOf(':') + 1)
      if (raw !== '') {
        const target = isAbsolute(raw) ? raw : resolve(profileDirectory, raw)
        if (existsSync(target) && statSync(target).isDirectory()) return realpathSync(target)
      }
    }
    const installed = join(profileDirectory, 'node_modules', ...packageName.split('/'))
    return existsSync(installed) && statSync(installed).isDirectory() ? realpathSync(installed) : undefined
  } catch {
    return undefined
  }
}

function readPackageOwnerKey(directory: string): string | undefined {
  try {
    const manifest = JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8')) as {
      dsh?: { arkme?: { clientOwnerKey?: unknown } }
    }
    const declared = manifest.dsh?.arkme?.clientOwnerKey
    if (typeof declared === 'string' && /^client-v1-[a-f0-9]{64}$/.test(declared)) return declared
  } catch { /* Fall through to the source sidecar used by older Arkme-generated bundles. */ }
  try {
    const source = JSON.parse(readFileSync(join(directory, 'arkme', 'source.json'), 'utf8')) as { clientCode?: unknown }
    return typeof source.clientCode === 'string' ? arkmeClientOwnerKey(source.clientCode) : undefined
  } catch { /* Fall through to the serialized spec in pre-owner-key generated wrappers. */ }
  try {
    const client = readFileSync(join(directory, 'lib', 'client.js'), 'utf8')
    const marker = ')(require, '
    const start = client.lastIndexOf(marker)
    const suffix = client.lastIndexOf('\n} })')
    if (start < 0 || suffix <= start || client[suffix - 1] !== ')') return undefined
    const spec = JSON.parse(client.slice(start + marker.length, suffix - 1)) as { code?: unknown }
    return typeof spec.code === 'string' ? arkmeClientOwnerKey(spec.code) : undefined
  } catch { return undefined }
}
