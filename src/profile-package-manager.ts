import { spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { lstatSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'

const EXACT_PNPM = /^pnpm@(?<version>\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)(?:\+[0-9A-Za-z.-]+)?$/
const LOCAL_EXTENSION_MINIMUM_RELEASE_AGE = '--config.minimum-release-age=0'

export interface ArkmeProfilePackageManagerResolution {
  declaration: string
  version: string
  source: 'profile' | 'install-metadata'
  profileUpdated: boolean
}

export interface ArkmeProfilePackageManagerOptions {
  environment?: NodeJS.ProcessEnv
  probeVersion?: (profileDirectory: string, environment: NodeJS.ProcessEnv) => string
}

export function localExtensionPnpmArgs(args: readonly string[]): string[] {
  return [LOCAL_EXTENSION_MINIMUM_RELEASE_AGE, ...args]
}

function profileDirectory(dshHome: string, profileName: string): string {
  if (profileName === '' || profileName.includes('/') || profileName.includes('\\')
    || profileName === '.' || profileName === '..' || profileName === 'node_modules') {
    throw new Error('Arkme Profile 名称无效')
  }
  return join(dshHome, 'profiles', profileName)
}

function exactPnpm(value: unknown): { declaration: string; version: string } | undefined {
  if (typeof value !== 'string') return undefined
  const match = EXACT_PNPM.exec(value)
  if (match?.groups?.version === undefined) return undefined
  return { declaration: value, version: match.groups.version }
}

function readObject(path: string, label: string): Record<string, unknown> {
  let value: unknown
  try {
    value = JSON.parse(readFileSync(path, 'utf8')) as unknown
  } catch (error) {
    throw new Error(`${label} 无法读取`, { cause: error })
  }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} 格式无效`)
  }
  return value as Record<string, unknown>
}

function readInstalledPackageManager(path: string): { declaration: string; version: string } | undefined {
  let content: string
  try { content = readFileSync(path, 'utf8') } catch { return undefined }
  try {
    const value = JSON.parse(content) as unknown
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      return exactPnpm((value as Record<string, unknown>).packageManager)
    }
  } catch { /* Older pnpm releases may emit YAML instead of JSON-compatible YAML. */ }
  for (const line of content.split(/\r?\n/)) {
    const match = /^\s*["']?packageManager["']?\s*:\s*["']?(pnpm@[^\s"',}]+)["']?\s*,?\s*$/.exec(line)
    const parsed = exactPnpm(match?.[1])
    if (parsed !== undefined) return parsed
  }
  return undefined
}

function writeManifest(path: string, manifest: Record<string, unknown>): void {
  const stat = lstatSync(path)
  if (!stat.isFile()) throw new Error('DSH Profile package.json 必须是普通文件')
  const temporary = join(dirname(path), `.${basename(path)}.arkme-${process.pid}-${randomUUID()}.tmp`)
  try {
    writeFileSync(temporary, `${JSON.stringify(manifest, undefined, 2)}\n`, {
      encoding: 'utf8', flag: 'wx', mode: stat.mode & 0o777,
    })
    renameSync(temporary, path)
  } finally {
    rmSync(temporary, { force: true })
  }
}

function probePnpmVersion(profile: string, environment: NodeJS.ProcessEnv): string {
  const result = spawnSync('pnpm', ['--version'], {
    cwd: profile,
    env: environment,
    encoding: 'utf8',
    shell: process.platform === 'win32',
  })
  if (result.error !== undefined) {
    if ((result.error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error('用户 PATH 中未找到 pnpm')
    }
    throw result.error
  }
  if (result.status !== 0) {
    const detail = result.stderr.trim().slice(0, 500)
    throw new Error(detail === '' ? '用户 pnpm 版本探测失败' : `用户 pnpm 版本探测失败：${detail}`)
  }
  return result.stdout.trim()
}

export function prepareProfilePackageManager(
  dshHome: string,
  profileName: string,
  options: ArkmeProfilePackageManagerOptions = {},
): ArkmeProfilePackageManagerResolution {
  const profile = profileDirectory(dshHome, profileName)
  const manifestPath = join(profile, 'package.json')
  const manifest = readObject(manifestPath, 'DSH Profile package.json')
  const configured = exactPnpm(manifest.packageManager)
  if (manifest.packageManager !== undefined && configured === undefined) {
    throw new Error('DSH Profile packageManager 必须声明精确的 pnpm 版本')
  }

  const installed = configured ?? readInstalledPackageManager(join(profile, 'node_modules', '.modules.yaml'))
  if (installed === undefined) {
    throw new Error('DSH Profile 未声明 packageManager，且现有 pnpm 安装元数据中没有可回填的版本')
  }
  if (configured === undefined) writeManifest(manifestPath, { ...manifest, packageManager: installed.declaration })

  const environment = options.environment ?? process.env
  const resolvedVersion = (options.probeVersion ?? probePnpmVersion)(profile, environment)
  if (resolvedVersion !== installed.version) {
    throw new Error(
      `DSH Profile 需要 pnpm ${installed.version}，但用户 PATH 解析为 ${resolvedVersion || '未知版本'}；`
      + '请启用 pnpm 的 packageManager 版本管理或安装匹配版本',
    )
  }
  return {
    ...installed,
    source: configured === undefined ? 'install-metadata' : 'profile',
    profileUpdated: configured === undefined,
  }
}
