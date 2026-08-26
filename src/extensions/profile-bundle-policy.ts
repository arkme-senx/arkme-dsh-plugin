import { randomUUID } from 'node:crypto'
import { readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { securePrivateFileSync } from '../private-filesystem.js'

const PACKAGE_NAME = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/

export interface ArkmeProfileBundlePolicyEntry {
  packageName: string
  enabled: boolean
}

export interface ArkmeProfileBundlePolicyResult {
  changed: boolean
  changedPackages: string[]
}

/** Return whether a package name is safe to use in DSH Profile dependency and Bundle fields. */
export function isArkmeProfilePackageName(value: string): boolean {
  return PACKAGE_NAME.test(value)
}

/**
 * Converge Arkme-owned Bundle layers onto their desired enabled state without changing dependencies.
 * Unmanaged Bundle order is preserved and enabled managed layers retain their existing position.
 */
export function applyArkmeProfileBundlePolicy(
  profileDirectory: string,
  entries: readonly ArkmeProfileBundlePolicyEntry[],
): ArkmeProfileBundlePolicyResult {
  const policy = new Map<string, boolean>()
  for (const entry of entries) {
    if (!isArkmeProfilePackageName(entry.packageName)) throw new Error('扩展 Bundle 包名无效')
    const previous = policy.get(entry.packageName)
    if (previous !== undefined && previous !== entry.enabled) throw new Error('扩展 Bundle 启用策略冲突')
    policy.set(entry.packageName, entry.enabled)
  }
  if (policy.size === 0) return { changed: false, changedPackages: [] }

  const manifestPath = join(profileDirectory, 'package.json')
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
    dependencies?: Record<string, string>
    dsh?: { profile?: { bundles?: string[] } }
  }
  const dependencies = manifest.dependencies
  if (dependencies === undefined || dependencies === null || Array.isArray(dependencies)) {
    throw new Error('DSH Profile 依赖配置无效')
  }
  const bundles = manifest.dsh?.profile?.bundles
  if (!Array.isArray(bundles) || bundles.some(value => typeof value !== 'string')) {
    throw new Error('DSH Profile Bundle 配置无效')
  }
  for (const [packageName, enabled] of policy) {
    if (enabled && dependencies[packageName] === undefined) throw new Error('扩展尚未安装到当前 DSH Profile')
  }

  const nextBundles: string[] = []
  const composedManaged = new Set<string>()
  for (const bundle of bundles) {
    const enabled = policy.get(bundle)
    if (enabled === undefined) {
      nextBundles.push(bundle)
      continue
    }
    if (enabled && !composedManaged.has(bundle)) {
      nextBundles.push(bundle)
      composedManaged.add(bundle)
    }
  }
  for (const [packageName, enabled] of policy) {
    if (enabled && !composedManaged.has(packageName)) nextBundles.push(packageName)
  }

  const changedPackages = [...policy]
    .filter(([packageName, enabled]) => bundles.includes(packageName) !== enabled)
    .map(([packageName]) => packageName)
  const changed = nextBundles.length !== bundles.length
    || nextBundles.some((value, index) => value !== bundles[index])
  if (!changed) return { changed: false, changedPackages: [] }

  manifest.dsh = { ...manifest.dsh, profile: { ...manifest.dsh?.profile, bundles: nextBundles } }
  const temporary = join(profileDirectory, `.package.${randomUUID()}.tmp`)
  try {
    writeFileSync(temporary, `${JSON.stringify(manifest, undefined, 2)}\n`, { mode: 0o600, flag: 'wx' })
    securePrivateFileSync(temporary)
    renameSync(temporary, manifestPath)
  } finally {
    rmSync(temporary, { force: true })
    try { securePrivateFileSync(manifestPath) } catch { /* Preserve the original write or rename error. */ }
  }
  return { changed: true, changedPackages }
}
