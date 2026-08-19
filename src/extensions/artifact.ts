import { createHash } from 'node:crypto'
import { gunzipSync, gzipSync } from 'node:zlib'
import {
  ARKME_EXTENSION_FORMAT, ARKME_EXTENSION_FORMAT_VERSION, ARKME_EXTENSION_MAX_BYTES,
  type ArkmeExtensionArtifact, type ArkmeExtensionManifest,
} from './types.js'

const TAR_BLOCK_BYTES = 512
const MAX_ARCHIVE_FILES = 50
const MAX_ASSET_FILES = 20
const MAX_TAR_OVERHEAD_BYTES = (MAX_ARCHIVE_FILES * 2 + 2) * TAR_BLOCK_BYTES
const ALLOWED_FILE = /^(?:manifest\.json|checksums\.json|host\.js|client\.js|assets\/[A-Za-z0-9][A-Za-z0-9._/-]{0,199})$/

export class ArkmeExtensionArtifactError extends Error {
  constructor(readonly code: string, message: string) {
    super(message)
    this.name = 'ArkmeExtensionArtifactError'
  }
}

export function sha256Hex(value: Uint8Array | string): string {
  return createHash('sha256').update(value).digest('hex')
}

export function assertExtensionArtifactSize(bytes: number, label = '扩展制品'): void {
  if (!Number.isSafeInteger(bytes) || bytes < 0 || bytes > ARKME_EXTENSION_MAX_BYTES) {
    throw new ArkmeExtensionArtifactError(
      'extension-artifact-too-large',
      `${label}不能超过 100 MiB（${ARKME_EXTENSION_MAX_BYTES} bytes）`,
    )
  }
}

export function canonicalExtensionJson(value: unknown): string {
  const normalize = (item: unknown): unknown => {
    if (Array.isArray(item)) return item.map(normalize)
    if (item !== null && typeof item === 'object') {
      return Object.fromEntries(Object.entries(item as Record<string, unknown>)
        .filter(([, child]) => child !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, normalize(child)]))
    }
    return item
  }
  return `${JSON.stringify(normalize(value), undefined, 2)}\n`
}

function normalizedSource(value: string): string {
  return value.replace(/\r\n?/g, '\n')
}

function validateArchivePath(path: string): void {
  if (!ALLOWED_FILE.test(path) || path.startsWith('/') || path.includes('..') || path.includes('\\')) {
    throw new ArkmeExtensionArtifactError('extension-artifact-path-invalid', `扩展制品包含非法路径：${path}`)
  }
}

function writeOctal(header: Buffer, offset: number, length: number, value: number): void {
  const octal = value.toString(8).padStart(length - 1, '0')
  header.write(octal.slice(-(length - 1)), offset, length - 1, 'ascii')
  header[offset + length - 1] = 0
}

function tarHeader(path: string, size: number): Buffer {
  const name = Buffer.from(path, 'utf8')
  if (name.byteLength > 100) {
    throw new ArkmeExtensionArtifactError('extension-artifact-path-too-long', `扩展制品路径过长：${path}`)
  }
  const header = Buffer.alloc(TAR_BLOCK_BYTES)
  name.copy(header, 0)
  writeOctal(header, 100, 8, 0o644)
  writeOctal(header, 108, 8, 0)
  writeOctal(header, 116, 8, 0)
  writeOctal(header, 124, 12, size)
  writeOctal(header, 136, 12, 0)
  header.fill(0x20, 148, 156)
  header[156] = '0'.charCodeAt(0)
  header.write('ustar\0', 257, 6, 'ascii')
  header.write('00', 263, 2, 'ascii')
  writeOctal(header, 148, 8, [...header].reduce((sum, byte) => sum + byte, 0))
  return header
}

function createTar(files: ReadonlyMap<string, Buffer>): Buffer {
  const chunks: Buffer[] = []
  let unpackedBytes = 0
  for (const [path, data] of [...files.entries()].sort(([left], [right]) => left.localeCompare(right))) {
    validateArchivePath(path)
    assertExtensionArtifactSize(data.byteLength, path)
    unpackedBytes += data.byteLength
    assertExtensionArtifactSize(unpackedBytes, '扩展解包文件总量')
    chunks.push(tarHeader(path, data.byteLength), data)
    const padding = (TAR_BLOCK_BYTES - data.byteLength % TAR_BLOCK_BYTES) % TAR_BLOCK_BYTES
    if (padding > 0) chunks.push(Buffer.alloc(padding))
  }
  chunks.push(Buffer.alloc(TAR_BLOCK_BYTES * 2))
  const tar = Buffer.concat(chunks)
  if (tar.byteLength > ARKME_EXTENSION_MAX_BYTES + MAX_TAR_OVERHEAD_BYTES) {
    throw new ArkmeExtensionArtifactError('extension-artifact-tar-overhead', '扩展 tar 结构开销异常')
  }
  return tar
}

function manifestFromInput(input: {
  name: string
  description: string
  version: string
  dshRange: string
  arkmeProviderContract: number
  permissions?: readonly string[]
  hostCode?: string
  clientCode?: string
}): ArkmeExtensionManifest {
  const name = input.name.trim()
  const description = input.description.trim()
  const version = input.version.trim()
  if (name === '' || name.length > 120) throw new ArkmeExtensionArtifactError('extension-name-invalid', '扩展名称无效')
  if (description.length > 2_000) throw new ArkmeExtensionArtifactError('extension-description-invalid', '扩展说明过长')
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) {
    throw new ArkmeExtensionArtifactError('extension-version-invalid', '扩展版本必须是 SemVer')
  }
  if (input.hostCode === undefined && input.clientCode === undefined) {
    throw new ArkmeExtensionArtifactError('extension-code-missing', '扩展至少需要 Host 或 Client 代码')
  }
  const permissions = [...new Set((input.permissions ?? []).map(value => value.trim()).filter(Boolean))].sort()
  return {
    format: ARKME_EXTENSION_FORMAT,
    format_version: ARKME_EXTENSION_FORMAT_VERSION,
    name,
    description,
    version,
    runtime: { dsh: input.dshRange.trim() || '>=0.1.0-rc.7', arkme_provider_contract: input.arkmeProviderContract },
    halves: { host: input.hostCode !== undefined, client: input.clientCode !== undefined },
    permissions,
    entrypoints: {
      ...(input.hostCode === undefined ? {} : { host: 'host.js' as const }),
      ...(input.clientCode === undefined ? {} : { client: 'client.js' as const }),
    },
  }
}

export function packArkmeExtension(input: {
  name: string
  description: string
  version: string
  dshRange?: string
  arkmeProviderContract: number
  permissions?: readonly string[]
  hostCode?: string
  clientCode?: string
  assets?: Readonly<Record<string, Uint8Array>>
}): ArkmeExtensionArtifact {
  const manifest = manifestFromInput({ ...input, dshRange: input.dshRange ?? '>=0.1.0-rc.7' })
  const payloadFiles = new Map<string, Buffer>()
  const manifestBytes = Buffer.from(canonicalExtensionJson(manifest), 'utf8')
  payloadFiles.set('manifest.json', manifestBytes)
  if (input.hostCode !== undefined) payloadFiles.set('host.js', Buffer.from(normalizedSource(input.hostCode), 'utf8'))
  if (input.clientCode !== undefined) payloadFiles.set('client.js', Buffer.from(normalizedSource(input.clientCode), 'utf8'))
  for (const [relativePath, bytes] of Object.entries(input.assets ?? {}).sort(([left], [right]) => left.localeCompare(right))) {
    const path = `assets/${relativePath}`
    validateArchivePath(path)
    payloadFiles.set(path, Buffer.from(bytes))
  }
  if ([...payloadFiles.keys()].filter(path => path.startsWith('assets/')).length > MAX_ASSET_FILES) {
    throw new ArkmeExtensionArtifactError('extension-artifact-asset-limit', `扩展制品最多包含 ${MAX_ASSET_FILES} 个资产文件`)
  }
  if (payloadFiles.size + 1 > MAX_ARCHIVE_FILES) {
    throw new ArkmeExtensionArtifactError('extension-artifact-file-limit', `扩展制品最多包含 ${MAX_ARCHIVE_FILES} 个文件`)
  }
  const checksums = Object.fromEntries([...payloadFiles.entries()]
    .filter(([path]) => path !== 'manifest.json')
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([path, bytes]) => [path, sha256Hex(bytes)]))
  payloadFiles.set('checksums.json', Buffer.from(canonicalExtensionJson({ files: checksums }), 'utf8'))
  const bytes = gzipSync(createTar(payloadFiles), { level: 9 })
  assertExtensionArtifactSize(bytes.byteLength)
  return {
    bytes,
    artifactSha256: sha256Hex(bytes),
    manifestSha256: sha256Hex(manifestBytes),
    manifest,
  }
}

function parseOctal(buffer: Buffer, offset: number, length: number): number {
  const value = buffer.subarray(offset, offset + length).toString('ascii').replace(/\0.*$/, '').trim()
  if (!/^[0-7]*$/.test(value)) throw new ArkmeExtensionArtifactError('extension-artifact-tar-invalid', '扩展制品 tar 数值字段无效')
  return value === '' ? 0 : Number.parseInt(value, 8)
}

function readTar(tar: Buffer): Map<string, Buffer> {
  const files = new Map<string, Buffer>()
  let offset = 0
  let unpackedBytes = 0
  while (offset + TAR_BLOCK_BYTES <= tar.byteLength) {
    const header = tar.subarray(offset, offset + TAR_BLOCK_BYTES)
    if (header.every(byte => byte === 0)) break
    const path = header.subarray(0, 100).toString('utf8').replace(/\0.*$/, '')
    validateArchivePath(path)
    if (files.has(path)) throw new ArkmeExtensionArtifactError('extension-artifact-duplicate-path', `扩展制品包含重复路径：${path}`)
    if (header[156] !== '0'.charCodeAt(0) && header[156] !== 0) {
      throw new ArkmeExtensionArtifactError('extension-artifact-entry-type', '扩展制品只允许普通文件')
    }
    const size = parseOctal(header, 124, 12)
    assertExtensionArtifactSize(size, path)
    unpackedBytes += size
    assertExtensionArtifactSize(unpackedBytes, '扩展解包文件总量')
    const start = offset + TAR_BLOCK_BYTES
    const end = start + size
    if (end > tar.byteLength) throw new ArkmeExtensionArtifactError('extension-artifact-truncated', '扩展制品内容不完整')
    files.set(path, Buffer.from(tar.subarray(start, end)))
    if (files.size > MAX_ARCHIVE_FILES) throw new ArkmeExtensionArtifactError('extension-artifact-file-limit', '扩展制品文件数量超限')
    offset = start + Math.ceil(size / TAR_BLOCK_BYTES) * TAR_BLOCK_BYTES
  }
  return files
}

function parseJsonObject(bytes: Buffer, label: string): Record<string, unknown> {
  try {
    const value = JSON.parse(bytes.toString('utf8')) as unknown
    if (value === null || Array.isArray(value) || typeof value !== 'object') throw new Error('not object')
    return value as Record<string, unknown>
  } catch (error) {
    throw new ArkmeExtensionArtifactError('extension-artifact-json-invalid', `${label}不是有效 JSON：${String(error)}`)
  }
}

export function unpackArkmeExtension(bytes: Uint8Array): {
  manifest: ArkmeExtensionManifest
  manifestSha256: string
  hostCode?: string
  clientCode?: string
  files: ReadonlyMap<string, Buffer>
} {
  assertExtensionArtifactSize(bytes.byteLength)
  let tar: Buffer
  try {
    tar = gunzipSync(bytes, { maxOutputLength: ARKME_EXTENSION_MAX_BYTES + MAX_TAR_OVERHEAD_BYTES })
  } catch (error) {
    throw new ArkmeExtensionArtifactError('extension-artifact-gzip-invalid', `扩展制品无法安全解压：${String(error)}`)
  }
  const files = readTar(tar)
  if ([...files.keys()].filter(path => path.startsWith('assets/')).length > MAX_ASSET_FILES) {
    throw new ArkmeExtensionArtifactError('extension-artifact-asset-limit', `扩展制品最多包含 ${MAX_ASSET_FILES} 个资产文件`)
  }
  const manifestBytes = files.get('manifest.json')
  const checksumBytes = files.get('checksums.json')
  if (manifestBytes === undefined || checksumBytes === undefined) {
    throw new ArkmeExtensionArtifactError('extension-artifact-required-file', '扩展制品缺少 manifest.json 或 checksums.json')
  }
  const checksumDocument = parseJsonObject(checksumBytes, 'checksums.json')
  const checksums = checksumDocument.files
  if (checksums === null || Array.isArray(checksums) || typeof checksums !== 'object') {
    throw new ArkmeExtensionArtifactError('extension-artifact-checksum-invalid', 'checksums.json 缺少 files 对象')
  }
  const checksumFiles = checksums as Record<string, unknown>
  for (const [path, file] of files) {
    if (path === 'checksums.json' || path === 'manifest.json') continue
    if (checksumFiles[path] !== sha256Hex(file)) {
      throw new ArkmeExtensionArtifactError('extension-artifact-checksum', `扩展文件摘要不匹配：${path}`)
    }
  }
  if (Object.keys(checksumFiles).some(path => path === 'checksums.json' || path === 'manifest.json' || !files.has(path))
    || Object.keys(checksumDocument).some(key => key !== 'files')) {
    throw new ArkmeExtensionArtifactError('extension-artifact-checksum-extra', 'checksums.json 包含无效文件记录')
  }
  const manifest = parseJsonObject(manifestBytes, 'manifest.json') as unknown as ArkmeExtensionManifest
  if (manifest.format !== ARKME_EXTENSION_FORMAT || manifest.format_version !== ARKME_EXTENSION_FORMAT_VERSION
    || typeof manifest.name !== 'string' || typeof manifest.description !== 'string' || typeof manifest.version !== 'string'
    || manifest.runtime === null || typeof manifest.runtime !== 'object'
    || typeof manifest.runtime.dsh !== 'string' || !Number.isSafeInteger(manifest.runtime.arkme_provider_contract)
    || manifest.halves === null || typeof manifest.halves !== 'object'
    || typeof manifest.halves.host !== 'boolean' || typeof manifest.halves.client !== 'boolean'
    || !Array.isArray(manifest.permissions) || !manifest.permissions.every(permission => typeof permission === 'string')
    || manifest.entrypoints === null || typeof manifest.entrypoints !== 'object') {
    throw new ArkmeExtensionArtifactError('extension-manifest-invalid', '扩展 manifest v1 无效')
  }
  const host = files.get('host.js')
  const client = files.get('client.js')
  if (manifest.halves.host !== (host !== undefined) || manifest.halves.client !== (client !== undefined)
    || (host === undefined && client === undefined)
    || (host === undefined ? manifest.entrypoints.host !== undefined : manifest.entrypoints.host !== 'host.js')
    || (client === undefined ? manifest.entrypoints.client !== undefined : manifest.entrypoints.client !== 'client.js')) {
    throw new ArkmeExtensionArtifactError('extension-manifest-halves', '扩展 manifest 与 Host/Client 文件不一致')
  }
  return {
    manifest,
    manifestSha256: sha256Hex(manifestBytes),
    ...(host === undefined ? {} : { hostCode: host.toString('utf8') }),
    ...(client === undefined ? {} : { clientCode: client.toString('utf8') }),
    files,
  }
}

export function canonicalExtensionSignatureMessage(input: {
  format_version: number
  extension_id: string
  version: string
  artifact_sha256: string
  manifest_sha256: string
  published_at: number
  signing_key_id: string
}): Buffer {
  return Buffer.from(JSON.stringify({
    format_version: input.format_version,
    extension_id: input.extension_id,
    version: input.version,
    artifact_sha256: input.artifact_sha256,
    manifest_sha256: input.manifest_sha256,
    published_at: input.published_at,
    signing_key_id: input.signing_key_id,
  }), 'utf8')
}
