import { createHash } from 'node:crypto'
import { closeSync, openSync, readdirSync, statSync, writeSync } from 'node:fs'
import { mkdir, mkdtemp, open, readdir, readFile, realpath, rename, rm, stat, symlink, utimes, writeFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { basename, join, relative } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { desktopRecorderImaAdpcmMonoWav } from './recording-import-ima-adpcm-fixture.js'
import { MAX_RECORDING_IMPORT_BYTES, RecordingImportContractError } from '../src/recording-import-contract.js'
import { LocalRecordingDirectorySource, copyRecordingDirectoryFile, probeRecordingDirectoryFile, scanRecordingDirectory } from '../src/recording-directory-source.js'

const roots: string[] = []

async function fixture(parent = tmpdir()) {
  const root = await mkdtemp(join(parent, 'arkme-directory-source-'))
  roots.push(root)
  const source = join(root, 'source')
  const temporary = join(root, 'recording-imports')
  await mkdir(source)
  await mkdir(temporary)
  return { root, source, temporary }
}

async function sparseFile(path: string, size: number) {
  const handle = await open(path, 'wx')
  try { await handle.truncate(size) } finally { await handle.close() }
}

function duringCopy(temporary: string, action: () => void) {
  let triggered = false
  const timer = setInterval(() => {
    if (triggered || !readdirSync(temporary).some(name => statSync(join(temporary, name)).size > 0)) return
    triggered = true
    action()
  }, 1)
  return { close: () => clearInterval(timer), triggered: () => triggered }
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

describe('host recording directory source', () => {
  it.each(['invalid-snapshot', 'mismatched-entry'] as const)('rejects %s before probing or staging an original file', async scenario => {
    const { source, temporary } = await fixture()
    const bytes = desktopRecorderImaAdpcmMonoWav()
    await writeFile(join(source, 'recording.wav'), bytes)
    const adapter = new LocalRecordingDirectorySource(temporary)
    const file = (await adapter.scan(source, false)).files[0]!
    const invalid = scenario === 'invalid-snapshot' ? { ...file, sourceSnapshot: 'invalid' }
      : { ...file, fileName: 'different.wav', relativePath: 'different.wav' }
    await expect(adapter.probe(invalid)).rejects.toMatchObject({ code: 'recording-directory-source-changed' })
    await expect(adapter.stage(invalid)).rejects.toMatchObject({ code: 'recording-directory-source-changed' })
    expect(await readdir(temporary)).toEqual([])
    expect(await readFile(join(source, 'recording.wav'))).toEqual(Buffer.from(bytes))
  })

  it('probes metadata directly without creating a recording copy', async () => {
    const { source, temporary } = await fixture()
    const bytes = desktopRecorderImaAdpcmMonoWav()
    await writeFile(join(source, 'recording.wav'), bytes)
    const scan = await scanRecordingDirectory(source, false)
    await expect(probeRecordingDirectoryFile(scan.root, scan.files[0]!)).resolves.toMatchObject({ kind: 'wav', durationMillis: 1010 })
    expect(await readdir(temporary)).toEqual([])
    expect(await readFile(join(source, 'recording.wav'))).toEqual(Buffer.from(bytes))
  })

  it('rejects a scanned recording replaced by a symlink before metadata probing', async () => {
    const { source, root } = await fixture()
    await writeFile(join(source, 'recording.wav'), desktopRecorderImaAdpcmMonoWav())
    const scan = await scanRecordingDirectory(source, false)
    await rename(join(source, 'recording.wav'), join(root, 'outside.wav'))
    await symlink(join(root, 'outside.wav'), join(source, 'recording.wav'))
    await expect(probeRecordingDirectoryFile(scan.root, scan.files[0]!)).rejects.toMatchObject({ code: 'recording-directory-source-changed' })
  })

  it('scans only supported regular files recursively with stable relative paths and identity snapshots', async () => {
    const { source, root } = await fixture()
    await mkdir(join(source, 'nested'))
    await writeFile(join(source, 'z.MP3'), 'mp3')
    await writeFile(join(source, 'nested', 'b.m4a'), 'm4a')
    await writeFile(join(source, 'a.wav'), 'wav')
    await writeFile(join(source, 'notes.txt'), 'text')
    await writeFile(join(root, 'outside.wav'), 'outside')
    await symlink(join(root, 'outside.wav'), join(source, 'linked.wav'))
    await symlink(root, join(source, 'linked-directory'))

    const result = await scanRecordingDirectory(source, true)

    expect(result.root).toEqual({ path: await realpath(source), dev: (await stat(source)).dev, ino: (await stat(source)).ino })
    expect(result.files.map(file => file.relativePath)).toEqual(['a.wav', join('nested', 'b.m4a'), 'z.MP3'])
    expect(result.files[0]).toEqual({
      relativePath: 'a.wav', fileName: 'a.wav', fileSize: 3,
      mtimeMs: (await stat(join(source, 'a.wav'))).mtimeMs,
      ctimeMs: (await stat(join(source, 'a.wav'))).ctimeMs,
      dev: (await stat(source)).dev, ino: (await stat(join(source, 'a.wav'))).ino,
    })
    expect(result.skipped).toBe(3)
  })

  it('does not descend into subdirectories when recursion is disabled', async () => {
    const { source } = await fixture()
    await mkdir(join(source, 'nested'))
    await writeFile(join(source, 'nested', 'hidden.wav'), 'hidden')
    await writeFile(join(source, 'direct.wav'), 'direct')

    const result = await scanRecordingDirectory(source, false)

    expect(result.files.map(file => file.fileName)).toEqual(['direct.wav'])
    expect(result.skipped).toBe(1)
  })

  it('expands a home-relative directory and canonicalizes an explicitly selected root symlink', async () => {
    const { source, root } = await fixture(homedir())
    await writeFile(join(source, 'voice.wav'), 'voice')
    const alias = join(root, 'alias')
    await symlink(source, alias)

    const result = await scanRecordingDirectory(`~/${relative(homedir(), alias)}`, true)

    expect(result.root.path).toBe(await realpath(source))
    expect(result.files.map(file => file.fileName)).toEqual(['voice.wav'])
  })

  it.each(['relative/path', '', '~another/path', '/invalid\0path'])(
    'rejects an invalid directory input safely: %s', async input => {
      await expect(scanRecordingDirectory(input, true)).rejects.toMatchObject({
        code: 'recording-directory-path-invalid',
      })
    },
  )

  it('does not expose private directory paths in scan failures', async () => {
    const { source } = await fixture()
    const path = join(source, 'private-missing-directory')
    const failure = await scanRecordingDirectory(path, true).catch(error => error)
    expect(failure).toBeInstanceOf(RecordingImportContractError)
    expect(failure.message).not.toContain(path)
  })

  it('rejects scans over 10000 entries instead of returning an incomplete candidate list', async () => {
    const { source } = await fixture()
    for (let offset = 0; offset < 10001; offset += 100) {
      await Promise.all(Array.from({ length: Math.min(100, 10001 - offset) }, (_, index) =>
        writeFile(join(source, `${offset + index}.txt`), ''),
      ))
    }

    await expect(scanRecordingDirectory(source, true)).rejects.toMatchObject({ code: 'recording-directory-entry-limit' })
  }, 20_000)

  it('copies stable files with a SHA-256 hash and private upload mode while preserving the original', async () => {
    const { source, temporary } = await fixture()
    const bytes = Buffer.from('recording-bytes')
    await writeFile(join(source, 'voice.wav'), bytes)
    const scan = await scanRecordingDirectory(source, true)

    const result = await copyRecordingDirectoryFile(scan.root, scan.files[0]!, temporary)

    expect(result.sourceHandle).toMatch(/\.upload$/)
    expect(relative(temporary, result.sourceHandle)).toBe(basename(result.sourceHandle))
    expect(result.sha256).toBe(createHash('sha256').update(bytes).digest('hex'))
    expect(await readFile(result.sourceHandle)).toEqual(bytes)
    expect((await stat(result.sourceHandle)).mode & 0o777).toBe(0o600)
    expect(await readFile(join(source, 'voice.wav'))).toEqual(bytes)
    expect(await scanRecordingDirectory(source, true)).toEqual(scan)
  })

  it('rejects a replaced root even when the candidate filename still exists', async () => {
    const { source, root, temporary } = await fixture()
    await writeFile(join(source, 'voice.wav'), 'voice')
    const scan = await scanRecordingDirectory(source, true)
    await rename(source, join(root, 'old-source'))
    await mkdir(source)
    await writeFile(join(source, 'voice.wav'), 'voice')

    await expect(copyRecordingDirectoryFile(scan.root, scan.files[0]!, temporary)).rejects.toMatchObject({ code: 'recording-directory-source-changed' })
    expect(await readdir(temporary)).toEqual([])
  })

  it('rejects a file or parent replaced by a symlink after the scan', async () => {
    const { source, root, temporary } = await fixture()
    await mkdir(join(source, 'nested'))
    await writeFile(join(source, 'nested', 'voice.wav'), 'voice')
    const scan = await scanRecordingDirectory(source, true)
    await rename(join(source, 'nested'), join(root, 'outside'))
    await symlink(join(root, 'outside'), join(source, 'nested'))

    await expect(copyRecordingDirectoryFile(scan.root, scan.files[0]!, temporary)).rejects.toMatchObject({ code: 'recording-directory-source-changed' })
    expect(await readdir(temporary)).toEqual([])
    await rm(join(source, 'nested'))
    await mkdir(join(source, 'nested'))
    await symlink(join(root, 'outside', 'voice.wav'), join(source, 'nested', 'voice.wav'))
    await expect(copyRecordingDirectoryFile(scan.root, scan.files[0]!, temporary)).rejects.toMatchObject({ code: 'recording-directory-source-changed' })
  })

  it('rejects a candidate outside the selected directory', async () => {
    const { source, root, temporary } = await fixture()
    await writeFile(join(source, 'voice.wav'), 'voice')
    await writeFile(join(root, 'outside.wav'), 'outside')
    const scan = await scanRecordingDirectory(source, true)

    await expect(copyRecordingDirectoryFile(scan.root, { ...scan.files[0]!, relativePath: '../outside.wav' }, temporary))
      .rejects.toMatchObject({ code: 'recording-directory-source-changed' })
    expect(await readdir(temporary)).toEqual([])
  })

  it('rejects changed source metadata even when file size is unchanged', async () => {
    const { source, temporary } = await fixture()
    const path = join(source, 'voice.wav')
    await writeFile(path, 'voice')
    const scan = await scanRecordingDirectory(source, true)
    await writeFile(path, 'other')
    await utimes(path, 10, 20)

    await expect(copyRecordingDirectoryFile(scan.root, scan.files[0]!, temporary)).rejects.toMatchObject({ code: 'recording-directory-source-changed' })
    expect(await readdir(temporary)).toEqual([])
    expect(await readFile(path, 'utf8')).toBe('other')
  })

  it.each([0, MAX_RECORDING_IMPORT_BYTES + 1])('rejects unsupported file size %s before copying bytes', async size => {
    const { source, temporary } = await fixture()
    await sparseFile(join(source, 'voice.wav'), size)
    const scan = await scanRecordingDirectory(source, true)

    await expect(copyRecordingDirectoryFile(scan.root, scan.files[0]!, temporary)).rejects.toMatchObject({
      code: size === 0 ? 'recording-import-size-invalid' : 'recording-import-size-exceeded',
    })
    expect(await readdir(temporary)).toEqual([])
    expect((await stat(join(source, 'voice.wav'))).size).toBe(size)
  })

  it('supports cancellation before scanning or copying without exposing the cancellation reason', async () => {
    const { source, temporary } = await fixture()
    await writeFile(join(source, 'voice.wav'), 'voice')
    const scan = await scanRecordingDirectory(source, true)
    const controller = new AbortController()
    controller.abort(new Error('private-path-or-secret'))

    await expect(scanRecordingDirectory(source, true, controller.signal)).rejects.toMatchObject({ code: 'recording-directory-cancelled', message: '目录录音导入已取消' })
    await expect(copyRecordingDirectoryFile(scan.root, scan.files[0]!, temporary, controller.signal)).rejects.toMatchObject({ code: 'recording-directory-cancelled', message: '目录录音导入已取消' })
    expect(await readdir(temporary)).toEqual([])
  })

  it('removes a partial copy when cancelled while streaming and leaves the original intact', async () => {
    const { source, temporary } = await fixture()
    const path = join(source, 'voice.wav')
    await sparseFile(path, 64 * 1024 * 1024)
    const scan = await scanRecordingDirectory(source, true)
    const controller = new AbortController()
    const observer = duringCopy(temporary, () => controller.abort())
    try {
      await expect(copyRecordingDirectoryFile(scan.root, scan.files[0]!, temporary, controller.signal))
        .rejects.toMatchObject({ code: 'recording-directory-cancelled' })
      expect(observer.triggered()).toBe(true)
    } finally { observer.close() }
    expect(await readdir(temporary)).toEqual([])
    expect((await stat(path)).size).toBe(scan.files[0]!.fileSize)
  })

  it('removes a partial copy when the source changes during streaming', async () => {
    const { source, temporary } = await fixture()
    const path = join(source, 'voice.wav')
    await sparseFile(path, 64 * 1024 * 1024)
    const scan = await scanRecordingDirectory(source, true)
    const observer = duringCopy(temporary, () => {
      const handle = openSync(path, 'r+')
      try { writeSync(handle, Buffer.from('x'), 0, 1, 0) } finally { closeSync(handle) }
    })
    try {
      await expect(copyRecordingDirectoryFile(scan.root, scan.files[0]!, temporary))
        .rejects.toMatchObject({ code: 'recording-directory-source-changed' })
      expect(observer.triggered()).toBe(true)
    } finally { observer.close() }
    expect(await readdir(temporary)).toEqual([])
    expect((await stat(path)).size).toBe(scan.files[0]!.fileSize)
  })

  it('maps destination failures to a safe contract error and preserves the source', async () => {
    const { source, root } = await fixture()
    const invalidTemporary = join(root, 'private-temporary-file')
    await writeFile(invalidTemporary, 'not-directory')
    await writeFile(join(source, 'voice.wav'), 'voice')
    const scan = await scanRecordingDirectory(source, true)

    const failure = await copyRecordingDirectoryFile(scan.root, scan.files[0]!, invalidTemporary).catch(error => error)

    expect(failure).toBeInstanceOf(RecordingImportContractError)
    expect(failure.code).toBe('recording-directory-copy-failed')
    expect(failure.message).not.toContain(root)
    expect(await readFile(join(source, 'voice.wav'), 'utf8')).toBe('voice')
    expect(await readFile(invalidTemporary, 'utf8')).toBe('not-directory')
  })

  it('fails closed if the host cannot enforce no-follow when opening a source file', async () => {
    const { source, temporary } = await fixture()
    await writeFile(join(source, 'voice.wav'), 'voice')
    const scan = await scanRecordingDirectory(source, true)
    vi.resetModules()
    vi.doMock('node:fs', async importOriginal => {
      const actual = await importOriginal<typeof import('node:fs')>()
      return { ...actual, constants: { ...actual.constants, O_NOFOLLOW: undefined } }
    })
    try {
      const unsupportedHost = await import('../src/recording-directory-source.js')
      await expect(unsupportedHost.copyRecordingDirectoryFile(scan.root, scan.files[0]!, temporary))
        .rejects.toMatchObject({ code: 'recording-directory-platform-unsupported' })
      expect(await readdir(temporary)).toEqual([])
    } finally {
      vi.doUnmock('node:fs')
      vi.resetModules()
    }
  })
})
