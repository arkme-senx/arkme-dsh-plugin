import { createHash, randomUUID } from 'node:crypto'
import { constants, type Stats } from 'node:fs'
import { lstat, mkdir, open, opendir, realpath, unlink, type FileHandle } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { LocalRecordingImportSource, probeRecordingImportSource, type RecordingImportProbe } from './recording-import-probe.js'
import { MAX_RECORDING_IMPORT_BYTES, RecordingImportContractError, type RecordingDirectorySource, type RecordingDirectorySelection, type RecordingDirectoryEntry } from './recording-import-contract.js'

export class LocalRecordingDirectorySource extends LocalRecordingImportSource implements RecordingDirectorySource {
  constructor(private readonly temporaryDirectory: string) { super() }

  async scan(directoryPath: string, recursive: boolean, signal?: AbortSignal): Promise<RecordingDirectorySelection> {
    const scan = await scanRecordingDirectory(directoryPath, recursive, signal)
    return {
      skipped: scan.skipped,
      files: scan.files.map(file => ({
        relativePath: file.relativePath, fileName: file.fileName, fileSize: file.fileSize,
        sourceSnapshot: JSON.stringify({ root: scan.root, file }),
      })),
    }
  }

  async probe(entry: RecordingDirectoryEntry, signal?: AbortSignal): Promise<RecordingImportProbe> {
    const { root, file } = directorySourceSnapshot(entry)
    return await probeRecordingDirectoryFile(root, file, signal)
  }

  async stage(entry: RecordingDirectoryEntry, signal?: AbortSignal): Promise<{ sourceHandle: string; sha256: string; mimeType: string }> {
    const { root, file } = directorySourceSnapshot(entry)
    return { ...await copyRecordingDirectoryFile(root, file, this.temporaryDirectory, signal), mimeType: recordingDirectoryMimeType(file.fileName) }
  }
}

function directorySourceSnapshot(entry: RecordingDirectoryEntry): { root: RecordingDirectoryRoot; file: RecordingDirectoryFile } {
  try {
    const snapshot = JSON.parse(entry.sourceSnapshot) as { root: RecordingDirectoryRoot; file: RecordingDirectoryFile }
    if (typeof snapshot.root.path !== 'string' || snapshot.file.relativePath !== entry.relativePath
      || snapshot.file.fileName !== entry.fileName || snapshot.file.fileSize !== entry.fileSize) throw sourceChanged()
    return snapshot
  } catch { throw sourceChanged() }
}

export interface RecordingDirectoryRoot {
  path: string
  dev: number
  ino: number
}

export interface RecordingDirectoryFile {
  relativePath: string
  fileName: string
  fileSize: number
  mtimeMs: number
  ctimeMs: number
  dev: number
  ino: number
}
export interface RecordingDirectoryScan {
  root: RecordingDirectoryRoot
  files: RecordingDirectoryFile[]
  skipped: number
}

function checkCancellation(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new RecordingImportContractError('recording-directory-cancelled', '目录录音导入已取消')
  }
}

function sourceChanged(): RecordingImportContractError {
  return new RecordingImportContractError('recording-directory-source-changed', '录音源文件或目录已变化，请重新扫描')
}

function sameIdentity(left: { dev: number; ino: number }, right: { dev: number; ino: number }): boolean {
  return left.dev === right.dev && left.ino === right.ino
}

function checkFile(file: RecordingDirectoryFile, metadata: Stats): void {
  if (!metadata.isFile() || !sameIdentity(file, metadata)
    || metadata.size !== file.fileSize || metadata.mtimeMs !== file.mtimeMs || metadata.ctimeMs !== file.ctimeMs) {
    throw sourceChanged()
  }
}

async function checkDirectories(root: RecordingDirectoryRoot, directory: string): Promise<Stats[]> {
  const rootMetadata = await lstat(root.path)
  if (!rootMetadata.isDirectory() || !sameIdentity(root, rootMetadata) || await realpath(root.path) !== root.path) {
    throw sourceChanged()
  }
  const parents = [rootMetadata]
  let current = root.path
  const relativeDirectory = relative(root.path, directory)
  for (const part of relativeDirectory ? relativeDirectory.split(sep) : []) {
    current = join(current, part)
    const metadata = await lstat(current)
    if (!metadata.isDirectory()) throw sourceChanged()
    parents.push(metadata)
  }
  return parents
}

function checkDirectoryIdentities(before: Stats[], after: Stats[]): void {
  if (before.length !== after.length || before.some((metadata, index) => !sameIdentity(metadata, after[index]!))) {
    throw sourceChanged()
  }
}

export async function scanRecordingDirectory(
  directoryPath: string,
  recursive: boolean,
  signal?: AbortSignal,
): Promise<RecordingDirectoryScan> {
  checkCancellation(signal)
  const expandedPath = directoryPath.startsWith('~/') ? join(homedir(), directoryPath.slice(2)) : directoryPath
  if (!isAbsolute(expandedPath) || expandedPath.includes('\0')) {
    throw new RecordingImportContractError('recording-directory-path-invalid', '请提供绝对目录路径或 ~/ 开头的目录路径')
  }
  try {
    const path = await realpath(expandedPath)
    const metadata = await lstat(path)
    if (!metadata.isDirectory()) {
      throw new RecordingImportContractError('recording-directory-path-invalid', '请选择可读取的录音目录')
    }
    const root = { path, dev: metadata.dev, ino: metadata.ino }
    const result: RecordingDirectoryScan = { root, files: [], skipped: 0 }
    let entryCount = 0
    async function scan(directory: string): Promise<void> {
      checkCancellation(signal)
      const parents = await checkDirectories(root, directory)
      const directoryBefore = parents[parents.length - 1]!
      const entries = await opendir(directory)
      for await (const entry of entries) {
        checkCancellation(signal)
        if (++entryCount > 10_000) {
          throw new RecordingImportContractError('recording-directory-entry-limit', '目录内容超过 10,000 项，请选择更小的目录')
        }
        const entryPath = join(directory, entry.name)
        const entryMetadata = await lstat(entryPath)
        if (entryMetadata.isDirectory() && recursive) {
          await scan(entryPath)
        } else if (entryMetadata.isFile() && /\.(wav|mp3|m4a)$/i.test(entry.name)) {
          result.files.push({
            relativePath: relative(path, entryPath),
            fileName: entry.name,
            fileSize: entryMetadata.size,
            mtimeMs: entryMetadata.mtimeMs,
            ctimeMs: entryMetadata.ctimeMs,
            dev: entryMetadata.dev,
            ino: entryMetadata.ino,
          })
        } else {
          result.skipped++
        }
      }
      const after = await checkDirectories(root, directory)
      checkDirectoryIdentities(parents, after)
      const directoryAfter = after[after.length - 1]!
      if (directoryBefore.mtimeMs !== directoryAfter.mtimeMs || directoryBefore.ctimeMs !== directoryAfter.ctimeMs) {
        throw sourceChanged()
      }
    }
    await scan(path)
    checkCancellation(signal)
    result.files.sort((left, right) => left.relativePath < right.relativePath ? -1 : left.relativePath > right.relativePath ? 1 : 0)
    return result
  } catch (error) {
    checkCancellation(signal)
    if (error instanceof RecordingImportContractError) throw error
    throw new RecordingImportContractError('recording-directory-scan-failed', '无法完整读取录音目录，请检查目录及访问权限')
  }
}

async function withRecordingDirectoryFile<T>(
  root: RecordingDirectoryRoot, file: RecordingDirectoryFile,
  read: (source: FileHandle) => Promise<T>, signal?: AbortSignal,
): Promise<T> {
  checkCancellation(signal)
  if (!constants.O_NOFOLLOW) {
    throw new RecordingImportContractError('recording-directory-platform-unsupported', '当前系统不支持安全读取目录录音')
  }
  if (!isAbsolute(root.path) || isAbsolute(file.relativePath) || file.relativePath.includes('\0')) throw sourceChanged()
  const sourcePath = resolve(root.path, file.relativePath)
  const relativePath = relative(root.path, sourcePath)
  if (!relativePath || relativePath === '..' || relativePath.startsWith(`..${sep}`) || isAbsolute(relativePath)
    || file.fileName !== basename(sourcePath) || !/\.(wav|mp3|m4a)$/i.test(file.fileName)) throw sourceChanged()
  if (!Number.isSafeInteger(file.fileSize) || file.fileSize <= 0) {
    throw new RecordingImportContractError('recording-import-size-invalid', '录音文件大小无效')
  }
  if (file.fileSize > MAX_RECORDING_IMPORT_BYTES) {
    throw new RecordingImportContractError('recording-import-size-exceeded', '录音文件不能超过 1 GiB')
  }
  let source: FileHandle | undefined
  try {
    let parents: Stats[]
    try {
      parents = await checkDirectories(root, dirname(sourcePath))
      checkFile(file, await lstat(sourcePath))
      source = await open(sourcePath, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
      checkFile(file, await source.stat())
      checkDirectoryIdentities(parents, await checkDirectories(root, dirname(sourcePath)))
    } catch { throw sourceChanged() }
    checkCancellation(signal)
    const result = await read(source)
    checkCancellation(signal)
    try {
      checkFile(file, await source.stat())
      checkFile(file, await lstat(sourcePath))
      checkDirectoryIdentities(parents, await checkDirectories(root, dirname(sourcePath)))
    } catch { throw sourceChanged() }
    return result
  } finally {
    await source?.close().catch(() => undefined)
  }
}

export function recordingDirectoryMimeType(fileName: string): string {
  return /\.wav$/i.test(fileName) ? 'audio/wav' : /\.mp3$/i.test(fileName) ? 'audio/mpeg' : 'audio/mp4'
}

export async function probeRecordingDirectoryFile(
  root: RecordingDirectoryRoot, file: RecordingDirectoryFile, signal?: AbortSignal,
): Promise<RecordingImportProbe> {
  return await withRecordingDirectoryFile(root, file, source => probeRecordingImportSource({
    size: file.fileSize,
    read: async (offset, length) => {
      checkCancellation(signal)
      const bytes = new Uint8Array(length)
      const { bytesRead } = await source.read(bytes, 0, length, offset)
      return bytes.subarray(0, bytesRead)
    },
  }, { ...file, mimeType: recordingDirectoryMimeType(file.fileName) }), signal)
}

export async function copyRecordingDirectoryFile(
  root: RecordingDirectoryRoot, file: RecordingDirectoryFile, temporaryDirectory: string, signal?: AbortSignal,
): Promise<{ sourceHandle: string; sha256: string }> {
  let temporaryPath: string | undefined
  try {
    return await withRecordingDirectoryFile(root, file, async source => {
      await mkdir(temporaryDirectory, { recursive: true, mode: 0o700 })
      const destinationPath = join(temporaryDirectory, `${randomUUID()}.upload`)
      const target = await open(destinationPath, 'wx', 0o600)
      temporaryPath = destinationPath
      try {
        const hash = createHash('sha256')
        const buffer = Buffer.allocUnsafe(64 * 1024)
        let copied = 0
        for (;;) {
          checkCancellation(signal)
          const { bytesRead } = await source.read(buffer, 0, buffer.length, copied)
          if (bytesRead === 0) break
          copied += bytesRead
          if (copied > file.fileSize || copied > MAX_RECORDING_IMPORT_BYTES) throw sourceChanged()
          hash.update(buffer.subarray(0, bytesRead))
          let written = 0
          while (written < bytesRead) {
            checkCancellation(signal)
            const { bytesWritten } = await target.write(buffer, written, bytesRead - written)
            if (bytesWritten === 0) throw new Error('写入未完成')
            written += bytesWritten
          }
        }
        if (copied !== file.fileSize) throw sourceChanged()
        return { sourceHandle: destinationPath, sha256: hash.digest('hex') }
      } finally { await target.close() }
    }, signal)
  } catch (error) {
    if (temporaryPath) await unlink(temporaryPath).catch(() => undefined)
    checkCancellation(signal)
    if (error instanceof RecordingImportContractError) throw error
    throw new RecordingImportContractError('recording-directory-copy-failed', '无法暂存录音文件，请检查文件及存储空间')
  }
}
