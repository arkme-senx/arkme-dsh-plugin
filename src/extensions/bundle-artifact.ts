import { createHash } from 'node:crypto'
import {
  lstatSync, readFileSync, readdirSync, realpathSync, statSync,
} from 'node:fs'
import { isAbsolute, join, posix, relative, resolve, sep } from 'node:path'
import { gunzipSync, gzipSync } from 'node:zlib'
import { parseDocument } from 'yaml'

export const ARKME_BUNDLE_CONTRACT_VERSION = 2 as const
export const ARKME_BUNDLE_ARTIFACT_KIND = 'dsh-bundle-tgz' as const
export const ARKME_BUNDLE_MAX_BYTES = 100 * 1024 * 1024
export type ArkmeBundleExecutionModel = 'arkme-sandboxed' | 'dsh-native'

const TAR_BLOCK_BYTES = 512
const MAX_ARCHIVE_FILES = 1024
const MAX_TAR_OVERHEAD_BYTES = (MAX_ARCHIVE_FILES * 2 + 2) * TAR_BLOCK_BYTES
const PACKAGE_NAME = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/
const SEMVER = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/

export interface ArkmeBundleArtifact {
  bytes: Uint8Array
  bundleSha256: string
  packageJsonSha256: string
  packageName: string
  version: string
  executionModel: ArkmeBundleExecutionModel
}

export interface ArkmeBundlePublishSource {
  bundle: ArkmeBundleArtifact
  source: { bytes: Uint8Array; sourceSha256: string }
}

export interface InspectedBundleArtifact extends ArkmeBundleArtifact {
  files: ReadonlyMap<string, Buffer>
  patchIds: string[]
}

export class ArkmeBundleArtifactError extends Error {
  constructor(readonly code: string, message: string) {
    super(message)
    this.name = 'ArkmeBundleArtifactError'
  }
}

export function bundleSha256(value: Uint8Array | string): string {
  return createHash('sha256').update(value).digest('hex')
}

export function arkmeSandboxEntryId(packageName: string): string {
  return `arkme-${bundleSha256(packageName).slice(0, 16)}-runtime`
}

export function renderArkmeSandboxHostEntry(packageName: string): string {
  const entryId = arkmeSandboxEntryId(packageName)
  return [
    `import { applyArkmeBundleHostExtension } from '@senguoyun/dsh-arkme/bundle-runtime'`,
    `export const name = ${JSON.stringify(entryId)}`,
    `export async function apply(ctx) {`,
    `  await applyArkmeBundleHostExtension(ctx, new URL('../arkme/source.json', import.meta.url), ${JSON.stringify(packageName)})`,
    `}`,
    '',
  ].join('\n')
}

function assertArchiveSize(bytes: number, label: string): void {
  if (!Number.isSafeInteger(bytes) || bytes <= 0 || bytes > ARKME_BUNDLE_MAX_BYTES) {
    throw new ArkmeBundleArtifactError('bundle-size-invalid', `${label}必须在 1 到 100 MiB 之间`)
  }
}

function canonicalJson(value: unknown): string {
  const normalize = (input: unknown): unknown => {
    if (Array.isArray(input)) return input.map(normalize)
    if (input !== null && typeof input === 'object') {
      return Object.fromEntries(Object.entries(input as Record<string, unknown>)
        .filter(([, child]) => child !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, child]) => [key, normalize(child)]))
    }
    return input
  }
  return `${JSON.stringify(normalize(value), undefined, 2)}\n`
}

function writeOctal(header: Buffer, offset: number, length: number, value: number): void {
  const octal = value.toString(8).padStart(length - 1, '0')
  header.write(octal.slice(-(length - 1)), offset, length - 1, 'ascii')
  header[offset + length - 1] = 0
}

function tarHeader(path: string, size: number): Buffer {
  const name = Buffer.from(path, 'utf8')
  if (name.byteLength > 100) throw new ArkmeBundleArtifactError('bundle-path-too-long', `Bundle 路径过长：${path}`)
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
  if (files.size === 0 || files.size > MAX_ARCHIVE_FILES) {
    throw new ArkmeBundleArtifactError('bundle-file-count-invalid', 'Bundle 文件数量无效')
  }
  const chunks: Buffer[] = []
  let unpackedBytes = 0
  for (const [path, data] of [...files.entries()].sort(([left], [right]) => left.localeCompare(right))) {
    validateArchivePath(path)
    unpackedBytes += data.byteLength
    if (unpackedBytes > ARKME_BUNDLE_MAX_BYTES) {
      throw new ArkmeBundleArtifactError('bundle-extracted-too-large', 'Bundle 解包总量超过 100 MiB')
    }
    chunks.push(tarHeader(path, data.byteLength), data)
    const padding = (TAR_BLOCK_BYTES - data.byteLength % TAR_BLOCK_BYTES) % TAR_BLOCK_BYTES
    if (padding > 0) chunks.push(Buffer.alloc(padding))
  }
  chunks.push(Buffer.alloc(TAR_BLOCK_BYTES * 2))
  return Buffer.concat(chunks)
}

function validateArchivePath(path: string): void {
  const clean = posix.normalize(path)
  if (!path.startsWith('package/') || clean !== path || path.includes('\\') || path.includes('\0')
    || path.startsWith('/') || path.split('/').includes('..')) {
    throw new ArkmeBundleArtifactError('bundle-path-invalid', `Bundle 包含非法路径：${path}`)
  }
}

function parseOctal(buffer: Buffer, offset: number, length: number): number {
  const value = buffer.subarray(offset, offset + length).toString('ascii').replace(/\0.*$/, '').trim()
  if (!/^[0-7]*$/.test(value)) throw new ArkmeBundleArtifactError('bundle-tar-invalid', 'Bundle tar 数值字段无效')
  return value === '' ? 0 : Number.parseInt(value, 8)
}

function readTar(tar: Buffer): Map<string, Buffer> {
  const files = new Map<string, Buffer>()
  let offset = 0
  let total = 0
  while (offset + TAR_BLOCK_BYTES <= tar.byteLength) {
    const header = tar.subarray(offset, offset + TAR_BLOCK_BYTES)
    if (header.every(byte => byte === 0)) break
    const path = header.subarray(0, 100).toString('utf8').replace(/\0.*$/, '')
    validateArchivePath(path)
    if (files.has(path)) throw new ArkmeBundleArtifactError('bundle-duplicate-path', `Bundle 包含重复路径：${path}`)
    const type = header[156]
    if (type !== '0'.charCodeAt(0) && type !== 0) {
      throw new ArkmeBundleArtifactError('bundle-link-forbidden', 'Bundle 只允许普通文件')
    }
    const size = parseOctal(header, 124, 12)
    total += size
    if (total > ARKME_BUNDLE_MAX_BYTES) throw new ArkmeBundleArtifactError('bundle-extracted-too-large', 'Bundle 解包总量超过 100 MiB')
    const start = offset + TAR_BLOCK_BYTES
    const end = start + size
    if (end > tar.byteLength) throw new ArkmeBundleArtifactError('bundle-tar-truncated', 'Bundle tar 内容不完整')
    files.set(path, Buffer.from(tar.subarray(start, end)))
    if (files.size > MAX_ARCHIVE_FILES) throw new ArkmeBundleArtifactError('bundle-file-count-invalid', 'Bundle 文件数量超过限制')
    offset = start + Math.ceil(size / TAR_BLOCK_BYTES) * TAR_BLOCK_BYTES
  }
  return files
}

interface BundleManifest {
  name: string
  version: string
  files: string[]
  scripts?: Record<string, unknown>
  dependencies?: Record<string, string>
  optionalDependencies?: Record<string, string>
  bundledDependencies?: string[]
  bundleDependencies?: string[]
  peerDependencies?: Record<string, string>
  bin?: unknown
  dsh?: {
    bundle?: { patch?: string }
    arkme?: { executionModel?: string; runtimeContract?: number }
  }
}

function readManifest(bytes: Buffer): BundleManifest {
  let value: unknown
  try { value = JSON.parse(bytes.toString('utf8')) as unknown } catch {
    throw new ArkmeBundleArtifactError('bundle-package-json-invalid', 'Bundle package.json 格式无效')
  }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new ArkmeBundleArtifactError('bundle-package-json-invalid', 'Bundle package.json 必须是对象')
  }
  return value as BundleManifest
}

function validateManifest(manifest: BundleManifest, files: ReadonlyMap<string, Buffer>): ArkmeBundleExecutionModel {
  if (typeof manifest.name !== 'string' || manifest.name.length > 214 || !PACKAGE_NAME.test(manifest.name)
    || manifest.name.startsWith('@deepseek-ai/') || manifest.name === '@senguoyun/dsh-arkme'
    || manifest.name.startsWith('@arkme-local/')) {
    throw new ArkmeBundleArtifactError('bundle-package-name-invalid', 'Bundle package name 无效或属于保留集合')
  }
  if (typeof manifest.version !== 'string' || !SEMVER.test(manifest.version)) {
    throw new ArkmeBundleArtifactError('bundle-version-invalid', 'Bundle version 必须是严格 SemVer')
  }
  if (!Array.isArray(manifest.files) || manifest.files.length === 0 || !manifest.files.every(item => typeof item === 'string')) {
    throw new ArkmeBundleArtifactError('bundle-files-missing', 'Bundle 必须显式声明 files')
  }
  if (manifest.scripts !== undefined && Object.keys(manifest.scripts).length > 0) {
    throw new ArkmeBundleArtifactError('bundle-scripts-forbidden', 'Bundle 不允许携带 scripts')
  }
  if (Object.keys(manifest.dependencies ?? {}).length > 0 || Object.keys(manifest.optionalDependencies ?? {}).length > 0
    || (manifest.bundledDependencies?.length ?? 0) > 0 || (manifest.bundleDependencies?.length ?? 0) > 0) {
    throw new ArkmeBundleArtifactError('bundle-dependencies-forbidden', 'Bundle 不允许携带运行时或捆绑依赖')
  }
  if (manifest.bin !== undefined && manifest.bin !== null) {
    throw new ArkmeBundleArtifactError('bundle-bin-forbidden', 'Bundle 不允许声明 bin')
  }
  for (const name of Object.keys(manifest.peerDependencies ?? {})) {
    if (!name.startsWith('@deepseek-ai/') && name !== '@senguoyun/dsh-arkme' && name !== 'react' && name !== 'react-dom') {
      throw new ArkmeBundleArtifactError('bundle-peer-forbidden', `Bundle peer dependency 不受支持：${name}`)
    }
  }
  const patch = manifest.dsh?.bundle?.patch
  if (typeof patch !== 'string' || patch.trim() === '') {
    throw new ArkmeBundleArtifactError('bundle-patch-missing', 'Bundle 必须声明 dsh.bundle.patch')
  }
  const patchPath = `package/${posix.normalize(patch.replace(/^\.\//, ''))}`
  if (!files.has(patchPath)) throw new ArkmeBundleArtifactError('bundle-patch-missing', 'Bundle patch 不在包内')
  const marker = manifest.dsh?.arkme
  if (marker?.executionModel === undefined) return 'dsh-native'
  if (marker.executionModel !== 'arkme-sandboxed' || marker.runtimeContract !== ARKME_BUNDLE_CONTRACT_VERSION
    || !files.has('package/arkme/source.json')) {
    throw new ArkmeBundleArtifactError('bundle-sandbox-marker-invalid', 'Arkme sandbox Bundle marker 无效')
  }
  if (files.get('package/lib/index.js')?.toString('utf8') !== renderArkmeSandboxHostEntry(manifest.name)) {
    throw new ArkmeBundleArtifactError('bundle-sandbox-entry-invalid', 'Arkme sandbox Bundle Host 入口无效')
  }
  return 'arkme-sandboxed'
}

function validatePatch(raw: Buffer, packageName: string): string[] {
  const document = parseDocument(raw.toString('utf8'), { uniqueKeys: true })
  if (document.errors.length > 0) throw new ArkmeBundleArtifactError('bundle-patch-invalid', 'Bundle patch YAML 格式无效')
  const value = document.toJS() as unknown
  if (!Array.isArray(value)) throw new ArkmeBundleArtifactError('bundle-patch-invalid', 'Bundle patch 必须是操作数组')
  const prefix = `arkme-${bundleSha256(packageName).slice(0, 16)}-`
  const ids = new Set<string>()
  for (const operation of value) {
    if (operation === null || typeof operation !== 'object' || Array.isArray(operation)
      || Object.keys(operation as Record<string, unknown>).length !== 1
      || !Array.isArray((operation as { insert?: unknown }).insert)) {
      throw new ArkmeBundleArtifactError('bundle-patch-operation-forbidden', 'Bundle patch 只允许 insert')
    }
    for (const row of (operation as { insert: unknown[] }).insert) {
      const item = row as { id?: unknown; name?: unknown }
      if (typeof item?.id !== 'string' || typeof item.name !== 'string') {
        throw new ArkmeBundleArtifactError('bundle-patch-row-invalid', 'Bundle patch row 必须声明 id 与 name')
      }
      if (!item.id.startsWith(prefix)) throw new ArkmeBundleArtifactError('bundle-patch-id-forbidden', 'Bundle patch id 不属于 package namespace')
      if (item.name !== packageName && !item.name.startsWith(`${packageName}/`)) {
        throw new ArkmeBundleArtifactError('bundle-patch-module-forbidden', 'Bundle patch 只能加载本 package')
      }
      if (ids.has(item.id)) throw new ArkmeBundleArtifactError('bundle-patch-id-duplicate', 'Bundle patch id 重复')
      ids.add(item.id)
    }
  }
  if (ids.size === 0) throw new ArkmeBundleArtifactError('bundle-patch-empty', 'Bundle patch 至少需要一条 row')
  return [...ids].sort()
}

export function inspectBundleArtifact(bytes: Uint8Array): InspectedBundleArtifact {
  assertArchiveSize(bytes.byteLength, 'Bundle')
  let tar: Buffer
  try { tar = gunzipSync(bytes, { maxOutputLength: ARKME_BUNDLE_MAX_BYTES + MAX_TAR_OVERHEAD_BYTES }) } catch {
    throw new ArkmeBundleArtifactError('bundle-gzip-invalid', 'Bundle 不是有效 gzip')
  }
  const files = readTar(tar)
  const packageJSON = files.get('package/package.json')
  if (packageJSON === undefined) throw new ArkmeBundleArtifactError('bundle-package-json-missing', 'Bundle 缺少 package.json')
  const manifest = readManifest(packageJSON)
  const executionModel = validateManifest(manifest, files)
  const patchPath = `package/${posix.normalize(manifest.dsh!.bundle!.patch!.replace(/^\.\//, ''))}`
  const patchIds = validatePatch(files.get(patchPath)!, manifest.name)
  return {
    bytes: Buffer.from(bytes),
    bundleSha256: bundleSha256(bytes),
    packageJsonSha256: bundleSha256(packageJSON),
    packageName: manifest.name,
    version: manifest.version,
    executionModel,
    files,
    patchIds,
  }
}

function pathInside(root: string, target: string): boolean {
  const fromRoot = relative(root, target)
  return fromRoot === '' || (!fromRoot.startsWith(`..${sep}`) && fromRoot !== '..' && !isAbsolute(fromRoot))
}

function collectPackageFiles(root: string, manifest: BundleManifest): Map<string, Buffer> {
  const canonicalRoot = realpathSync(root)
  const selected = new Map<string, Buffer>()
  const add = (absolute: string): void => {
    const stat = lstatSync(absolute)
    if (stat.isSymbolicLink()) throw new ArkmeBundleArtifactError('bundle-link-forbidden', 'Bundle source 不允许符号链接')
    const canonical = realpathSync(absolute)
    if (!pathInside(canonicalRoot, canonical)) throw new ArkmeBundleArtifactError('bundle-path-invalid', 'Bundle source 逃逸 package root')
    if (stat.isDirectory()) {
      for (const child of readdirSync(canonical).sort()) add(join(canonical, child))
      return
    }
    if (!stat.isFile()) throw new ArkmeBundleArtifactError('bundle-file-type-forbidden', 'Bundle source 只允许普通文件')
    const rel = relative(canonicalRoot, canonical).split(sep).join('/')
    selected.set(`package/${rel}`, readFileSync(canonical))
  }
  add(join(canonicalRoot, 'package.json'))
  for (const entry of manifest.files) {
    if (entry.includes('*') || entry.includes('?') || entry.includes('[') || entry.includes('\\')) {
      throw new ArkmeBundleArtifactError('bundle-files-invalid', 'Bundle files 暂不接受 glob 或反斜杠')
    }
    const target = resolve(canonicalRoot, entry)
    if (!pathInside(canonicalRoot, target) || !statSync(target).isFile() && !statSync(target).isDirectory()) {
      throw new ArkmeBundleArtifactError('bundle-files-invalid', `Bundle files 路径无效：${entry}`)
    }
    add(target)
  }
  return selected
}

export function packBundleFiles(files: ReadonlyMap<string, Buffer>): ArkmeBundlePublishSource {
  const bytes = gzipSync(createTar(files), { level: 9 })
  assertArchiveSize(bytes.byteLength, 'Bundle')
  const inspected = inspectBundleArtifact(bytes)
  return {
    bundle: inspected,
    source: { bytes: Buffer.from(bytes), sourceSha256: bundleSha256(bytes) },
  }
}

export function packLocalBundleDirectory(directory: string): ArkmeBundlePublishSource {
  const packageJSON = readFileSync(join(directory, 'package.json'))
  const manifest = readManifest(packageJSON)
  return packBundleFiles(collectPackageFiles(directory, manifest))
}

export function readLocalBundleTarball(path: string): ArkmeBundlePublishSource {
  if (!lstatSync(path).isFile()) throw new ArkmeBundleArtifactError('bundle-tarball-invalid', '本地 Bundle tgz 必须是普通文件')
  const bytes = readFileSync(path)
  const inspected = inspectBundleArtifact(bytes)
  return {
    bundle: inspected,
    source: { bytes: Buffer.from(bytes), sourceSha256: bundleSha256(bytes) },
  }
}

export function canonicalBundleJson(value: unknown): string {
  return canonicalJson(value)
}
