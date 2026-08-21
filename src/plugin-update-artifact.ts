import { createHash, createPublicKey, randomUUID, verify } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { chmod, mkdir, rename, unlink, writeFile } from 'node:fs/promises'
import { join, posix } from 'node:path'
import { gunzipSync } from 'node:zlib'
import semver from 'semver'
import type { ArkmePluginUpdateLevel, ArkmePluginUpdateNotice } from './types.js'

export const ARKME_PLUGIN_PACKAGE_NAME = '@senguoyun/dsh-arkme'
const PLUGIN_UPDATE_API_PATH = '/api/public/v1/arkme/plugin-update/latest'
const MAX_PLUGIN_MANIFEST_BYTES = 64 * 1024
const MAX_PLUGIN_ARTIFACT_BYTES = 100 * 1024 * 1024
const MAX_TAR_FILES = 4096
const MAX_TAR_OVERHEAD_BYTES = (MAX_TAR_FILES * 2 + 2) * 512
const TAR_BLOCK_BYTES = 512
const SHA512_HEX = /^[A-Fa-f0-9]{128}$/
const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/

export interface PluginUpdateManifestV1 {
  schemaVersion: 1
  packageName: typeof ARKME_PLUGIN_PACKAGE_NAME
  version: string
  artifactUrl: string
  downloadUrl: string
  artifactSize: number
  sha512: string
  manifestSignature: string
  appVersionRange: string
  dshVersionRange: string
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

function safeNotice(value: unknown): PluginUpdateManifestV1['notice'] {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new PluginUpdateArtifactError('plugin-update-notice-invalid', '插件更新说明格式无效')
  }
  const source = value as Record<string, unknown>
  const level = source.level === 'important' || source.level === 'critical' ? source.level : 'normal'
  const title = stringValue(source.title, 80)
  const summary = stringValue(source.summary, 300)
  if (title === undefined || summary === undefined) {
    throw new PluginUpdateArtifactError('plugin-update-notice-invalid', '插件更新说明缺少标题或摘要')
  }
  const releaseNotesUrl = stringValue(source.releaseNotesUrl, 2048)
  if (releaseNotesUrl !== undefined) {
    const parsed = new URL(releaseNotesUrl)
    if (parsed.protocol !== 'https:' || parsed.username !== '' || parsed.password !== '' || parsed.hostname === '') {
      throw new PluginUpdateArtifactError('plugin-update-notice-invalid', '插件 release notes URL 必须是 HTTPS')
    }
  }
  return {
    level,
    title,
    summary,
    ...(releaseNotesUrl === undefined ? {} : { releaseNotesUrl }),
  }
}

function assertCompatible(version: string | undefined, range: string, code: string): void {
  if (version === undefined || version.trim() === '') return
  if (semver.valid(version) === null) {
    throw new PluginUpdateArtifactError(code, '本地版本号无效')
  }
  if (!semver.satisfies(version, range, { includePrerelease: true })) {
    throw new PluginUpdateArtifactError(code, '插件更新与当前版本不兼容')
  }
}

function validateArtifactUrl(raw: string): string {
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
  return url.toString()
}

export function parsePluginUpdateManifest(
  value: unknown,
  options: {
    updateServiceOrigin: string
    artifactOrigin?: string
    appVersion?: string
    dshVersion?: string
  },
): PluginUpdateManifestV1 {
  validatePluginUpdateServiceOrigin(options.updateServiceOrigin)
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new PluginUpdateArtifactError('plugin-update-response-invalid', '更新服务返回格式无效', true)
  }
  const source = value as Record<string, unknown>
  const version = stringValue(source.version, 128)
  const artifactUrl = stringValue(source.downloadUrl, 4096)
  if (version === undefined || !SEMVER.test(version) || artifactUrl === undefined) {
    throw new PluginUpdateArtifactError('plugin-update-response-invalid', '更新服务返回格式无效', true)
  }
  assertNoControls(version, 'version')
  return {
    schemaVersion: 1,
    packageName: ARKME_PLUGIN_PACKAGE_NAME,
    version,
    artifactUrl: validateArtifactUrl(artifactUrl),
    downloadUrl: validateArtifactUrl(artifactUrl),
    artifactSize: MAX_PLUGIN_ARTIFACT_BYTES,
    sha512: '', manifestSignature: '', appVersionRange: '*', dshVersionRange: '*',
    notice: { level: 'normal', title: '插件更新', summary: stringValue(source.releaseNotes, 300) ?? '发现新版本' },
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

export function canonicalPluginUpdateManifestMessage(manifest: Pick<
  PluginUpdateManifestV1,
  'version' | 'artifactSize' | 'sha512' | 'appVersionRange' | 'dshVersionRange'
>): Buffer {
  return Buffer.from(JSON.stringify({
    domain: 'arkme-plugin-manifest-v1',
    packageName: ARKME_PLUGIN_PACKAGE_NAME,
    version: manifest.version,
    artifactSize: manifest.artifactSize,
    sha512: manifest.sha512.toLowerCase(),
    appVersionRange: manifest.appVersionRange,
    dshVersionRange: manifest.dshVersionRange,
  }), 'utf8')
}

function publicKey(value: string) {
  if (value.includes('BEGIN PUBLIC KEY')) return createPublicKey(value)
  const decoded = Buffer.from(value, 'base64')
  if (decoded.byteLength === 32) {
    return createPublicKey({
      key: { kty: 'OKP', crv: 'Ed25519', x: decoded.toString('base64url') },
      format: 'jwk',
    })
  }
  return createPublicKey({ key: decoded, format: 'der', type: 'spki' })
}

export function verifyPluginUpdateManifestSignature(
  manifest: PluginUpdateManifestV1,
  trustedPublicKey: string,
): void {
  const key = stringValue(trustedPublicKey, 16 * 1024)
  if (key === undefined) {
    throw new PluginUpdateArtifactError('plugin-update-signing-key-unconfigured', '插件更新签名公钥未配置')
  }
  let valid = false
  try {
    valid = verify(
      null,
      canonicalPluginUpdateManifestMessage(manifest),
      publicKey(key),
      Buffer.from(manifest.manifestSignature, 'base64'),
    )
  } catch (error) {
    throw new PluginUpdateArtifactError('plugin-update-signature-invalid', `插件更新签名格式无效：${String(error)}`)
  }
  if (!valid) {
    throw new PluginUpdateArtifactError('plugin-update-signature-invalid', '插件更新签名验证失败')
  }
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
    if (header.every(byte => byte === 0)) break
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
  return files
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
  if (manifest.name !== ARKME_PLUGIN_PACKAGE_NAME || typeof manifest.version !== 'string' || !SEMVER.test(manifest.version)) {
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

function sha512Hex(bytes: Uint8Array): string {
  return createHash('sha512').update(bytes).digest('hex')
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
    trustedPublicKey?: string
    fetchImpl?: typeof fetch
    requestTimeoutMs?: number
  },
): Promise<string> {
  const cachedPath = cachedPluginArtifactPath(options.cacheDirectory, manifest.version)
  if (existsSync(cachedPath)) {
    const cachedBytes = readFileSync(cachedPath)
    const inspected = inspectPluginPackageTgz(cachedBytes)
    if (inspected.version === manifest.version) {
      return cachedPath
    }
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
  const manifestBytes = Buffer.from(`${JSON.stringify(manifest, undefined, 2)}\n`, 'utf8')
  if (manifestBytes.byteLength <= MAX_PLUGIN_MANIFEST_BYTES) {
    await writeFile(join(targetDirectory, 'release-manifest.json'), manifestBytes, { mode: 0o600 })
  }
  return cachedPath
}
