import { randomUUID } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { chmod, mkdir, rename, unlink, writeFile } from 'node:fs/promises'
import { join, posix } from 'node:path'
import { gunzipSync } from 'node:zlib'
import semver from 'semver'
import type { ArkmePluginUpdateLevel } from './types.js'

export const ARKME_PLUGIN_PACKAGE_NAME = '@senguoyun/dsh-arkme'
const PLUGIN_UPDATE_API_PATH = '/api/public/v1/arkme/plugin-update/latest'
const MAX_PLUGIN_ARTIFACT_BYTES = 100 * 1024 * 1024
const MAX_TAR_FILES = 4096
const MAX_TAR_OVERHEAD_BYTES = (MAX_TAR_FILES * 2 + 2) * 512
const TAR_BLOCK_BYTES = 512

export interface PluginUpdateManifestV1 {
  schemaVersion: 1
  packageName: typeof ARKME_PLUGIN_PACKAGE_NAME
  version: string
  artifactUrl: string
  artifactSize: number
  notice: {
    level: ArkmePluginUpdateLevel
    title: string
    summary: string
    releaseNotesUrl?: string
  }
}

export interface InspectedPluginPackageTgz {
  packageName: typeof ARKME_PLUGIN_PACKAGE_NAME
  version: string
  files: ReadonlyMap<string, Buffer>
}

export class PluginUpdateArtifactError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly retryable = false,
  ) {
    super(message)
    this.name = 'PluginUpdateArtifactError'
  }
}

function stringValue(value: unknown, maxLength: number): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  if (trimmed === '' || trimmed.length > maxLength) return undefined
  return trimmed
}

function assertNoControls(value: string, label: string): void {
  for (const character of value) {
    if (character < ' ' || character === '\x7f') {
      throw new PluginUpdateArtifactError('plugin-update-manifest-control', `${label} 包含非法控制字符`)
    }
  }
}

export function validatePluginUpdateServiceOrigin(raw: string): string {
  const url = new URL(raw)
  if (url.hostname.toLowerCase() === 'registry.npmjs.org') {
    throw new Error('dsh-arkme: update service must not use the npm registry')
  }
  if (url.protocol !== 'https:' || url.username !== '' || url.password !== ''
    || url.pathname !== '/' || url.search !== '' || url.hash !== '') {
    throw new Error('dsh-arkme: update service base URL must be an HTTPS origin without credentials or path')
  }
  return url.origin
}

export function validatePluginUpdateArtifactOrigin(raw: string): string {
  const url = new URL(raw)
  if (url.hostname.toLowerCase() === 'registry.npmjs.org') {
    throw new Error('dsh-arkme: update artifacts must not use the npm registry')
  }
  if (url.protocol !== 'https:' || url.username !== '' || url.password !== ''
    || url.pathname !== '/' || url.search !== '' || url.hash !== '') {
    throw new Error('dsh-arkme: update artifact base URL must be an HTTPS origin without credentials or path')
  }
  return url.origin
}

function validateArtifactUrl(raw: string, expectedOrigin?: string): string {
  const url = new URL(raw)
  if (url.protocol !== 'https:' || url.username !== '' || url.password !== ''
    || url.hostname === '' || url.hash !== '' || url.hostname.toLowerCase() === 'registry.npmjs.org') {
    throw new PluginUpdateArtifactError('plugin-update-artifact-url-invalid', '插件更新制品 URL 必须是非 npm 的 HTTPS 下载地址')
  }
  if (url.pathname === '' || url.pathname === '/'
    || url.pathname.includes('\\')
    || url.pathname.split('/').includes('..')
    || url.pathname.endsWith('/')) {
    throw new PluginUpdateArtifactError('plugin-update-artifact-url-invalid', '插件更新制品 URL 路径无效')
  }
  if (expectedOrigin !== undefined && url.origin !== validatePluginUpdateArtifactOrigin(expectedOrigin)) {
    throw new PluginUpdateArtifactError('plugin-update-artifact-origin-invalid', '插件更新制品 URL 不属于受信下载源')
  }
  return url.toString()
}

export function parsePluginUpdateManifest(
  value: unknown,
  options: {
    updateServiceOrigin: string
    artifactOrigin?: string
  },
): PluginUpdateManifestV1 {
  validatePluginUpdateServiceOrigin(options.updateServiceOrigin)
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new PluginUpdateArtifactError('plugin-update-response-invalid', '更新服务返回格式无效', true)
  }
  const source = value as Record<string, unknown>
  const version = stringValue(source.version, 128)
  const artifactUrl = stringValue(source.downloadUrl, 4096)
  if (version === undefined || semver.valid(version) === null || artifactUrl === undefined) {
    throw new PluginUpdateArtifactError('plugin-update-response-invalid', '更新服务返回格式无效', true)
  }
  assertNoControls(version, 'version')
  const releaseNotes = stringValue(source.releaseNotes, 300)
  if (releaseNotes !== undefined) assertNoControls(releaseNotes, 'releaseNotes')
  return {
    schemaVersion: 1,
    packageName: ARKME_PLUGIN_PACKAGE_NAME,
    version,
    artifactUrl: validateArtifactUrl(artifactUrl, options.artifactOrigin),
    artifactSize: MAX_PLUGIN_ARTIFACT_BYTES,
    notice: { level: 'normal', title: '插件更新', summary: releaseNotes ?? '发现新版本' },
  }
}

export function pluginUpdateEndpointUrl(
  updateServiceOrigin: string,
  input: {
    appVersion?: string
    dshVersion?: string
    currentVersion: string
  },
): URL {
  const url = new URL(PLUGIN_UPDATE_API_PATH, validatePluginUpdateServiceOrigin(updateServiceOrigin))
  url.searchParams.set('app_version', input.appVersion ?? '')
  url.searchParams.set('dsh_version', input.dshVersion ?? '')
  url.searchParams.set('current_version', input.currentVersion)
  return url
}

function parseOctal(buffer: Buffer, offset: number, length: number): number {
  const value = buffer.subarray(offset, offset + length).toString('ascii').replace(/\0.*$/, '').trim()
  if (!/^[0-7]*$/.test(value)) {
    throw new PluginUpdateArtifactError('plugin-update-tgz-invalid', '插件 tgz tar 数值字段无效')
  }
  return value === '' ? 0 : Number.parseInt(value, 8)
}

function tarPath(header: Buffer): string {
  const name = header.subarray(0, 100).toString('utf8').replace(/\0.*$/, '')
  const prefix = header.subarray(345, 500).toString('utf8').replace(/\0.*$/, '')
  return prefix === '' ? name : `${prefix}/${name}`
}

function assertTarHeaderChecksum(header: Buffer): void {
  const expected = parseOctal(header, 148, 8)
  let actual = 0
  for (let index = 0; index < header.byteLength; index += 1) {
    actual += index >= 148 && index < 156 ? 0x20 : header[index] ?? 0
  }
  if (expected !== actual) {
    throw new PluginUpdateArtifactError('plugin-update-tgz-checksum-invalid', '插件 tgz tar 头校验失败')
  }
}

function validateTarPath(path: string): void {
  const clean = posix.normalize(path)
  if (!path.startsWith('package/') || clean !== path || path.includes('\\') || path.includes('\0')
    || path.startsWith('/') || path.split('/').includes('..') || /^[A-Za-z]:/.test(path)) {
    throw new PluginUpdateArtifactError('plugin-update-tgz-path-invalid', `插件 tgz 包含非法路径：${path}`)
  }
  for (const character of path) {
    if (character < ' ' || character === '\x7f') {
      throw new PluginUpdateArtifactError('plugin-update-tgz-path-invalid', '插件 tgz 路径包含控制字符')
    }
  }
}

function readTar(tar: Buffer): Map<string, Buffer> {
  const files = new Map<string, Buffer>()
  let offset = 0
  let total = 0
  while (offset + TAR_BLOCK_BYTES <= tar.byteLength) {
    const header = tar.subarray(offset, offset + TAR_BLOCK_BYTES)
    if (header.every(byte => byte === 0)) {
      if (!tar.subarray(offset).every(byte => byte === 0)) {
        throw new PluginUpdateArtifactError('plugin-update-tgz-trailing-data', '插件 tgz tar 结束块后包含额外数据')
      }
      return files
    }
    assertTarHeaderChecksum(header)
    const path = tarPath(header)
    validateTarPath(path)
    if (files.has(path)) {
      throw new PluginUpdateArtifactError('plugin-update-tgz-duplicate-path', `插件 tgz 包含重复路径：${path}`)
    }
    const type = header[156]
    if (type !== '0'.charCodeAt(0) && type !== 0) {
      throw new PluginUpdateArtifactError('plugin-update-tgz-entry-type', '插件 tgz 只允许普通文件')
    }
    const size = parseOctal(header, 124, 12)
    total += size
    if (total > MAX_PLUGIN_ARTIFACT_BYTES) {
      throw new PluginUpdateArtifactError('plugin-update-tgz-too-large', '插件 tgz 解包总量超过限制')
    }
    const start = offset + TAR_BLOCK_BYTES
    const end = start + size
    if (end > tar.byteLength) {
      throw new PluginUpdateArtifactError('plugin-update-tgz-truncated', '插件 tgz 内容不完整')
    }
    files.set(path, Buffer.from(tar.subarray(start, end)))
    if (files.size > MAX_TAR_FILES) {
      throw new PluginUpdateArtifactError('plugin-update-tgz-file-count', '插件 tgz 文件数量超限')
    }
    offset = start + Math.ceil(size / TAR_BLOCK_BYTES) * TAR_BLOCK_BYTES
  }
  throw new PluginUpdateArtifactError('plugin-update-tgz-end-missing', '插件 tgz 缺少 tar 结束块')
}

function readPackageJSON(bytes: Buffer): Record<string, unknown> {
  try {
    const value = JSON.parse(bytes.toString('utf8')) as unknown
    if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error('not object')
    return value as Record<string, unknown>
  } catch (error) {
    throw new PluginUpdateArtifactError('plugin-update-package-json-invalid', `插件 package.json 无效：${String(error)}`)
  }
}

function normalizePackagePath(path: string): string {
  return `package/${posix.normalize(path.replace(/^\.\//, ''))}`
}

export function inspectPluginPackageTgz(bytes: Uint8Array): InspectedPluginPackageTgz {
  if (bytes.byteLength <= 0 || bytes.byteLength > MAX_PLUGIN_ARTIFACT_BYTES) {
    throw new PluginUpdateArtifactError('plugin-update-artifact-size-invalid', '插件制品大小无效')
  }
  let tar: Buffer
  try {
    tar = gunzipSync(bytes, { maxOutputLength: MAX_PLUGIN_ARTIFACT_BYTES + MAX_TAR_OVERHEAD_BYTES })
  } catch (error) {
    throw new PluginUpdateArtifactError('plugin-update-gzip-invalid', `插件 tgz 无法安全解压：${String(error)}`)
  }
  const files = readTar(tar)
  const packageJson = files.get('package/package.json')
  if (packageJson === undefined || !files.has('package/lib/index.js') || !files.has('package/lib/client.js')) {
    throw new PluginUpdateArtifactError('plugin-update-required-file-missing', '插件 tgz 缺少必要入口文件')
  }
  const manifest = readPackageJSON(packageJson)
  if (manifest.name !== ARKME_PLUGIN_PACKAGE_NAME || typeof manifest.version !== 'string'
    || semver.valid(manifest.version) === null) {
    throw new PluginUpdateArtifactError('plugin-update-package-identity-invalid', '插件 tgz package identity 无效')
  }
  const dsh = manifest.dsh
  const patch = dsh !== null && typeof dsh === 'object' && !Array.isArray(dsh)
    ? (dsh as { bundle?: { patch?: unknown } }).bundle?.patch
    : undefined
  if (typeof patch !== 'string' || patch.trim() === '' || !files.has(normalizePackagePath(patch))) {
    throw new PluginUpdateArtifactError('plugin-update-bundle-patch-missing', '插件 tgz 缺少 dsh.bundle.patch')
  }
  return {
    packageName: ARKME_PLUGIN_PACKAGE_NAME,
    version: manifest.version,
    files,
  }
}

export function cachedPluginArtifactPath(cacheDirectory: string, version: string): string {
  return join(cacheDirectory, version, `dsh-arkme-${version}.tgz`)
}

export function existingCachedPluginArtifactPath(cacheDirectory: string, version: string): string | undefined {
  const path = cachedPluginArtifactPath(cacheDirectory, version)
  return existsSync(path) ? path : undefined
}

async function readResponseBytes(
  response: Response,
  maximumSize: number,
): Promise<Buffer> {
  const declared = Number(response.headers.get('content-length'))
  if (Number.isFinite(declared) && declared > maximumSize) {
    throw new PluginUpdateArtifactError('plugin-update-artifact-too-large', '插件制品响应超过最大限制', true)
  }
  if (response.body === null) {
    const bytes = Buffer.from(await response.arrayBuffer())
    if (bytes.byteLength > maximumSize) {
      throw new PluginUpdateArtifactError('plugin-update-artifact-too-large', '插件制品响应超过最大限制', true)
    }
    return bytes
  }
  const reader = response.body.getReader()
  const chunks: Buffer[] = []
  let total = 0
  while (true) {
    const result = await reader.read()
    if (result.done) break
    total += result.value.byteLength
    if (total > maximumSize || total > MAX_PLUGIN_ARTIFACT_BYTES) {
      await reader.cancel()
      throw new PluginUpdateArtifactError('plugin-update-artifact-too-large', '插件制品响应超过声明大小', true)
    }
    chunks.push(Buffer.from(result.value))
  }
  return Buffer.concat(chunks)
}

async function fetchPluginArtifactBytes(
  manifest: PluginUpdateManifestV1,
  options: {
    fetchImpl: typeof fetch
    requestTimeoutMs: number
  },
): Promise<Buffer> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), options.requestTimeoutMs)
  timeout.unref?.()
  try {
    const response = await options.fetchImpl(manifest.artifactUrl, {
      method: 'GET',
      headers: { Accept: 'application/octet-stream' },
      redirect: 'error',
      signal: controller.signal,
    })
    if (!response.ok) {
      throw new PluginUpdateArtifactError(
        'plugin-update-artifact-http-error',
        `插件制品下载返回 HTTP ${String(response.status)}`,
        response.status >= 500 || response.status === 429,
      )
    }
    return await readResponseBytes(response, manifest.artifactSize)
  } catch (error) {
    if (error instanceof PluginUpdateArtifactError) throw error
    throw new PluginUpdateArtifactError(
      controller.signal.aborted ? 'plugin-update-artifact-timeout' : 'plugin-update-artifact-network-error',
      controller.signal.aborted ? '插件制品下载超时' : '无法下载插件制品',
      true,
    )
  } finally {
    clearTimeout(timeout)
  }
}

export async function downloadAndCachePluginArtifact(
  manifest: PluginUpdateManifestV1,
  options: {
    cacheDirectory: string
    artifactOrigin?: string
    fetchImpl?: typeof fetch
    requestTimeoutMs?: number
  },
): Promise<string> {
  validateArtifactUrl(manifest.artifactUrl, options.artifactOrigin)
  const cachedPath = cachedPluginArtifactPath(options.cacheDirectory, manifest.version)
  if (existsSync(cachedPath)) {
    try {
      const inspected = inspectPluginPackageTgz(readFileSync(cachedPath))
      if (inspected.version === manifest.version) return cachedPath
    } catch { /* A partial or invalid cache entry is replaced from the trusted update origin. */ }
    await unlink(cachedPath).catch(() => undefined)
  }
  const bytes = await fetchPluginArtifactBytes(manifest, {
    fetchImpl: options.fetchImpl ?? globalThis.fetch.bind(globalThis),
    requestTimeoutMs: options.requestTimeoutMs ?? 30_000,
  })
  const inspected = inspectPluginPackageTgz(bytes)
  if (inspected.packageName !== ARKME_PLUGIN_PACKAGE_NAME || inspected.version !== manifest.version) {
    throw new PluginUpdateArtifactError('plugin-update-package-identity-invalid', '插件制品包名或版本不匹配')
  }
  const targetDirectory = join(options.cacheDirectory, manifest.version)
  const temporaryDirectory = join(options.cacheDirectory, '.tmp')
  await mkdir(targetDirectory, { recursive: true, mode: 0o700 })
  await chmod(targetDirectory, 0o700)
  await mkdir(temporaryDirectory, { recursive: true, mode: 0o700 })
  await chmod(temporaryDirectory, 0o700)
  const temporaryPath = join(temporaryDirectory, `${process.pid}.${randomUUID()}.tgz`)
  await writeFile(temporaryPath, bytes, { mode: 0o600 })
  await chmod(temporaryPath, 0o600)
  try {
    await rename(temporaryPath, cachedPath)
  } catch (error) {
    await unlink(temporaryPath).catch(() => undefined)
    throw error
  }
  await chmod(cachedPath, 0o600)
  return cachedPath
}
