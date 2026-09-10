import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { FileTransfers, type FileTransferPorts } from '../src/services/file-transfers.js'
import { arkmeCanInlineLocalFile, arkmePickedFileKind, arkmeVisibleUploadFraction } from '../src/file-transfer-contract.js'
import { fileTaskTimelineItem } from '../src/client/file-send-tasks.js'
import { createArkmeFileTransfers } from '../src/file-transfer-owner.js'
import { ArkmePluginError } from '../src/services/service.js'
import { ArkmeStateStore } from '../src/state-store.js'

const directories: string[] = []
afterEach(async () => { await Promise.all(directories.splice(0).map(path => rm(path, { recursive: true, force: true }))) })
async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'arkme files ')); directories.push(directory)
  let user = 42
  const upload = vi.fn<FileTransferPorts['upload']>(async (_path, metadata) => ({ ...metadata, fileAssetUid: `asset-${metadata.fileName}` }))
  const send = vi.fn<FileTransferPorts['send']>(async input => ({ kind: 'owner_accepted', result: {
    sourceRef: input.sourceRef, itemUid: input.recordUid, status: 1, localState: 'synced',
  } }))
  const validateSource = vi.fn(async () => {})
  const openPath = vi.fn<NonNullable<FileTransferPorts['openPath']>>(async () => {})
  const ports: FileTransferPorts = { currentUser: async () => user, upload, send, validateSource,
    fetchMedia: async () => { throw new Error('unexpected download') }, openPath }
  const owner = new FileTransfers(directory, ports, 1000)
  async function stage(name: string, retention?: 'references') {
    const path = join(directory, name); await writeFile(path, name.padEnd(10, '.').slice(0, 10))
    return owner.stage(path, { fileName: name, mimeType: 'application/pdf', size: 10 }, undefined, retention)
  }
  return { owner, directory, ports, upload, send, validateSource, openPath, stage, setUser: (value: number) => { user = value } }
}
const input = (fileRefs: string[]) => ({ sourceRef: 'source', recordUid: '00000000-0000-4000-8000-000000000001', relationUid: '00000000-0000-4000-8000-000000000002', fileRefs, content: { textContent: 'hello' } })

describe('account-bound file lifecycle', () => {
  it('reclaims expired reference-managed staging after receipts release it, including after restart', async () => {
    const f = await fixture()
    const file = await f.stage('edit.pdf', 'references')
    let retained = [file.fileRef]
    f.ports.retainedFileRefs = async () => retained
    await f.owner.uploadRefs([file.fileRef])
    const restarted = new FileTransfers(f.directory, f.ports, 1000)
    const clock = vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 30 * 24 * 3600_000)
    try {
      await restarted.stageBytes('YQ==', { fileName: 'retained.pdf', mimeType: 'application/pdf' })
      await expect(restarted.readLocal(file.fileRef)).resolves.toMatchObject({ file })
      retained = []
      await restarted.stageBytes('Yg==', { fileName: 'released.pdf', mimeType: 'application/pdf' })
      await expect(restarted.readLocal(file.fileRef)).rejects.toMatchObject({ code: 'file-ref-invalid' })
      expect(await restarted.tasks()).toEqual([])
    } finally { clock.mockRestore() }
  })

  it('does not change shared file retention when a re-edit borrows and uploads it', async () => {
    const f = await fixture()
    const file = await f.stage('shared.pdf')
    f.ports.retainedFileRefs = async () => []
    await f.owner.uploadRefs([file.fileRef])
    const restarted = new FileTransfers(f.directory, f.ports, 1000)
    const clock = vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 30 * 24 * 3600_000)
    try {
      await restarted.stageBytes('YQ==', { fileName: 'next.pdf', mimeType: 'application/pdf' })
      await expect(restarted.readLocal(file.fileRef)).resolves.toMatchObject({ file })
    } finally { clock.mockRestore() }
  })

  it('releases expired abandoned re-edit capacity without raising the 256-file limit', async () => {
    const f = await fixture()
    f.ports.retainedFileRefs = async () => []
    for (let index = 0; index < 256; index++) await f.stage('edit.pdf', 'references')
    await expect(f.stage('full.pdf')).rejects.toMatchObject({ code: 'file-cache-full' })
    const clock = vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 8 * 24 * 3600_000)
    try {
      const next = await f.stage('next.pdf')
      expect(await f.owner.files()).toEqual([next])
    } finally { clock.mockRestore() }
  })

  it('persists cleanup even when the subsequent import fails', async () => {
    const f = await fixture()
    f.ports.retainedFileRefs = async () => []
    await f.stage('edit.pdf', 'references')
    const clock = vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 8 * 24 * 3600_000)
    try {
      await expect(f.owner.stage(join(f.directory, 'missing'), { fileName: 'a.pdf', mimeType: 'application/pdf', size: 10 })).rejects.toThrow()
      const restarted = new FileTransfers(f.directory, f.ports, 1000)
      expect(await restarted.files()).toEqual([])
    } finally { clock.mockRestore() }
  })

  it('keeps bytes and in-memory metadata when cleanup persistence fails', async () => {
    const f = await fixture()
    f.ports.retainedFileRefs = async () => []
    const file = await f.stage('edit.pdf', 'references')
    const path = join(f.directory, '42', 'state.json')
    await rm(path)
    await mkdir(path)
    const clock = vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 8 * 24 * 3600_000)
    try {
      await expect(f.stage('next.pdf')).rejects.toThrow()
      await expect(f.owner.readLocal(file.fileRef)).resolves.toMatchObject({ file })
      expect(await f.owner.files()).toEqual([file])
    } finally { clock.mockRestore() }
  })

  it('serializes reference persistence with removal and cache collection', async () => {
    const f = await fixture()
    const file = await f.stage('edit.pdf', 'references')
    let retained: string[] = []
    f.ports.retainedFileRefs = async () => retained
    const clock = vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 8 * 24 * 3600_000)
    let release!: () => void
    try {
      const saved = f.owner.withReferences([file.fileRef], 42, async () => {
        await new Promise<void>(resolve => { release = resolve })
        retained = [file.fileRef]
        return 'saved'
      })
      await vi.waitFor(() => expect(release).toBeTypeOf('function'))
      const staging = f.stage('next.pdf')
      const removing = expect(f.owner.remove(file.fileRef)).rejects.toMatchObject({ code: 'file-in-use' })
      release()
      expect(await saved).toBe('saved')
      await staging
      await removing
      await expect(f.owner.readLocal(file.fileRef)).resolves.toMatchObject({ file })
      retained = []
      await f.owner.remove(file.fileRef)
      const write = vi.fn()
      await expect(f.owner.withReferences([file.fileRef], 42, write)).rejects.toMatchObject({ code: 'file-ref-invalid' })
      expect(write).not.toHaveBeenCalled()
    } finally { release?.(); clock.mockRestore() }
  })

  it('keeps reference-managed staging while retention evidence is unavailable', async () => {
    const f = await fixture()
    const file = await f.stage('edit.pdf', 'references')
    const clock = vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 8 * 24 * 3600_000)
    try {
      await f.stage('without.pdf')
      await expect(f.owner.readLocal(file.fileRef)).resolves.toMatchObject({ file })
      f.ports.retainedFileRefs = async () => { throw new Error('unavailable') }
      await f.stage('failed.pdf')
      await expect(f.owner.readLocal(file.fileRef)).resolves.toMatchObject({ file })
    } finally { clock.mockRestore() }
  })

  it('never treats a malformed persisted draft as proof of reference release', async () => {
    const f = await fixture()
    const file = await f.stage('edit.pdf', 'references')
    const store = new ArkmeStateStore(f.directory)
    await store.putRecordReeditDraft(42, {
      schemaVersion: 1, sourceIdentityKey: 'identity', lastSourceRef: 'source', itemUid: 'record',
      title: '', textContent: '保留草稿', attachments: [{ fileRef: file.fileRef }],
      baseVersion: 7, baseContentFingerprint: 'a'.repeat(64), editDurationMillis: 0, updatedAtMillis: 1,
    })
    const path = join(f.directory, 'state.json')
    const raw = JSON.parse(await readFile(path, 'utf8'))
    raw.recordReeditDraftsByUser['42']['identity\u0000record'].draftRevision = 'corrupted'
    await writeFile(path, JSON.stringify(raw))
    const restarted = new ArkmeStateStore(f.directory)
    f.ports.retainedFileRefs = userId => restarted.recordReeditFileRefs(userId)
    const clock = vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 8 * 24 * 3600_000)
    try {
      const ordinary = await f.stage('next.pdf')
      await expect(f.owner.readLocal(file.fileRef)).resolves.toMatchObject({ file })
      await f.owner.enqueue(input([ordinary.fileRef]))
      await f.owner.settled()
      expect(f.send).toHaveBeenCalledOnce()
      await restarted.putPending(42, { recordUid: 'ordinary', textContent: '普通消息', createdAtMillis: 1, sendAtMillis: 1, attempts: 0 })
      expect(JSON.parse(await readFile(path, 'utf8')).recordReeditDraftsByUser).toEqual(raw.recordReeditDraftsByUser)
      await expect(new ArkmeStateStore(f.directory).recordReeditFileRefs(42)).rejects.toThrow('草稿')
    } finally { clock.mockRestore() }
  })

  it('never infers reference release from a sent task when the reference provider is absent', async () => {
    const f = await fixture()
    const file = await f.stage('edit.pdf', 'references')
    await f.owner.enqueue(input([file.fileRef]))
    await f.owner.settled()
    const clock = vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 8 * 24 * 3600_000)
    try {
      await f.stage('next.pdf')
      await expect(f.owner.readLocal(file.fileRef)).resolves.toMatchObject({ file })
    } finally { clock.mockRestore() }
  })

  it('preserves missing already-owned references for draft recovery but rejects new missing references', async () => {
    const f = await fixture()
    const file = await f.stage('edit.pdf', 'references')
    f.ports.retainedFileRefs = async () => [file.fileRef]
    await rm((await f.owner.readLocal(file.fileRef)).path)
    const persist = vi.fn(async () => 'draft text preserved')
    await expect(f.owner.withReferences([file.fileRef], 42, persist)).resolves.toBe('draft text preserved')
    const unknown = 'arkme-file-v1.00000000-0000-4000-8000-000000000099'
    await expect(f.owner.withReferences([unknown], 42, persist)).rejects.toMatchObject({ code: 'file-ref-invalid' })
    expect(persist).toHaveBeenCalledOnce()
  })

  it('releases the local critical section on persistence failure and rejects account changes', async () => {
    const f = await fixture()
    const file = await f.stage('edit.pdf', 'references')
    await expect(f.owner.withReferences([file.fileRef], 42, async () => { throw new Error('disk failed') })).rejects.toThrow('disk failed')
    await expect(f.stage('next.pdf')).resolves.toBeDefined()
    f.setUser(43)
    const persist = vi.fn()
    await expect(f.owner.withReferences([file.fileRef], 42, persist)).rejects.toMatchObject({ code: 'file-account-changed' })
    expect(persist).not.toHaveBeenCalled()
  })

  it.each(['direct', 'send'] as const)('protects expired reference-managed bytes during %s upload without blocking staging', async mode => {
    const f = await fixture()
    f.ports.retainedFileRefs = async () => []
    const file = await f.stage('edit.pdf', 'references')
    let release!: () => void
    f.upload.mockImplementationOnce(async (_path, metadata) => {
      await new Promise<void>(resolve => { release = resolve })
      return { ...metadata, fileAssetUid: 'asset' }
    })
    const job = mode === 'direct' ? f.owner.uploadRefs([file.fileRef]) : f.owner.enqueue(input([file.fileRef]))
    await vi.waitFor(() => expect(release).toBeTypeOf('function'))
    const clock = vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 8 * 24 * 3600_000)
    try {
      await f.stage('next.pdf')
      await expect(f.owner.readLocal(file.fileRef)).resolves.toMatchObject({ file })
    } finally { release(); await job; await f.owner.settled(); clock.mockRestore() }
  })

  it.each(['owner_not_accepted', 'owner_outcome_unknown'] as const)('protects expired reference-managed files for %s send recovery', async kind => {
    const f = await fixture()
    f.ports.retainedFileRefs = async () => []
    const file = await f.stage('edit.pdf', 'references')
    f.send.mockResolvedValueOnce({ kind, message: 'retry later' })
    await f.owner.enqueue(input([file.fileRef]))
    await f.owner.settled()
    const clock = vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 8 * 24 * 3600_000)
    try {
      await f.stage('next.pdf')
      await expect(f.owner.readLocal(file.fileRef)).resolves.toMatchObject({ file })
    } finally { clock.mockRestore() }
  })
  it('keeps ordinary staging and sending available when edit retention evidence is unreadable', async () => {
    const f = await fixture()
    const original = await f.stage('keep.pdf')
    f.ports.retainedFileRefs = async () => { throw new Error('提交状态损坏') }
    const next = await f.stage('next.pdf')
    await f.owner.enqueue(input([next.fileRef]))
    await f.owner.settled()
    expect(f.send).toHaveBeenCalledOnce()
    await expect(f.owner.remove(original.fileRef)).rejects.toThrow('提交状态损坏')
    expect((await f.owner.readLocal(original.fileRef)).file.fileRef).toBe(original.fileRef)
  })

  it('deduplicates queued direct uploads of the same file', async () => {
    const f = await fixture()
    const file = await f.stage('edit.pdf')
    let release!: () => void
    f.upload.mockImplementationOnce(async (_path, metadata) => {
      await new Promise<void>(resolve => { release = resolve })
      return { ...metadata, fileAssetUid: 'edit-asset' }
    })
    const first = f.owner.uploadRefs([file.fileRef])
    await vi.waitFor(() => expect(release).toBeTypeOf('function'))
    const second = f.owner.uploadRefs([file.fileRef])
    release()
    expect(await second).toEqual(await first)
    expect(f.upload).toHaveBeenCalledOnce()
  })

  it('does not upload a cancelled direct request after its queue predecessor finishes', async () => {
    const f = await fixture()
    const firstFile = await f.stage('first.pdf')
    const nextFile = await f.stage('next.pdf')
    let release!: () => void
    f.upload.mockImplementationOnce(async (_path, metadata) => {
      await new Promise<void>(resolve => { release = resolve })
      return { ...metadata, fileAssetUid: 'first-asset' }
    })
    const first = f.owner.uploadRefs([firstFile.fileRef])
    await vi.waitFor(() => expect(release).toBeTypeOf('function'))
    const controller = new AbortController()
    const cancelled = f.owner.uploadRefs([nextFile.fileRef], controller.signal)
    const rejected = expect(cancelled).rejects.toThrow()
    controller.abort()
    release()
    await first
    await rejected
    expect(f.upload).toHaveBeenCalledOnce()
    await f.owner.remove(nextFile.fileRef)
  })

  it('keeps ordinary staging and sending responsive during a direct re-edit upload', async () => {
    const f = await fixture()
    const file = await f.stage('edit.pdf')
    let release!: () => void
    f.upload.mockImplementationOnce(async (_path, metadata) => {
      await new Promise<void>(resolve => { release = resolve })
      return { ...metadata, fileAssetUid: 'edit-asset' }
    })
    const editing = f.owner.uploadRefs([file.fileRef])
    await vi.waitFor(() => expect(release).toBeTypeOf('function'))
    let staged = false
    const ordinary = f.stage('next.pdf').then(value => { staged = true; return value })
    try {
      await vi.waitFor(() => expect(staged).toBe(true), { timeout: 300 })
      await f.owner.enqueue(input([(await ordinary).fileRef]))
      await vi.waitFor(() => expect(f.send).toHaveBeenCalledOnce())
      await expect(f.owner.remove(file.fileRef)).rejects.toMatchObject({ code: 'file-in-use' })
    } finally {
      release()
      await editing
      await ordinary
      await f.owner.settled()
    }
    await f.owner.remove(file.fileRef)
  })

  it('does not reuse a background audio asset for an ordinary re-edit attachment', async () => {
    const f = await fixture()
    const path = join(f.directory, 'audio.m4a'); await writeFile(path, '0123456789')
    const audio = await f.owner.stage(path, { fileName: 'audio.m4a', mimeType: 'audio/mp4', size: 10 })
    await f.owner.enqueue({ ...input([audio.fileRef]), backgroundSound: { fileRefs: [audio.fileRef], amplitudes: [0.3] } })
    await f.owner.settled()
    expect(f.upload.mock.calls.map(call => call[1].fileKind)).toEqual([2])
    const result = await f.owner.uploadRefs([audio.fileRef])
    expect(f.upload.mock.calls.map(call => call[1].fileKind)).toEqual([2, 4])
    expect(result[0]?.fileKind).toBe(4)
  })

  it('protects files referenced by an edit draft until that draft releases them', async () => {
    const f = await fixture()
    const file = await f.stage('edit.pdf')
    f.ports.retainedFileRefs = async userId => userId === 42 ? [file.fileRef] : []
    await expect(f.owner.remove(file.fileRef)).rejects.toMatchObject({ code: 'file-in-use' })
    expect((await f.owner.readLocal(file.fileRef)).file).toEqual(file)
    f.ports.retainedFileRefs = async () => []
    await f.owner.remove(file.fileRef)
    expect(await f.owner.files()).toEqual([])
  })
  it('does not prune an old sent file still selected by an edit draft', async () => {
    const f = await fixture()
    const file = await f.stage('keep.pdf')
    await f.owner.enqueue(input([file.fileRef]))
    await f.owner.settled()
    f.ports.retainedFileRefs = async () => [file.fileRef]
    const now = Date.now()
    const clock = vi.spyOn(Date, 'now').mockReturnValue(now + 8 * 24 * 3600_000)
    try {
      await f.stage('next.pdf')
      expect((await f.owner.readLocal(file.fileRef)).file).toEqual(file)
      f.ports.retainedFileRefs = async () => []
      await f.stage('after.pdf')
      await expect(f.owner.readLocal(file.fileRef)).rejects.toMatchObject({ code: 'file-ref-invalid' })
    } finally { clock.mockRestore() }
  })
  it('resumes cleanup only after unavailable edit retention evidence recovers', async () => {
    const f = await fixture()
    const file = await f.stage('keep.pdf')
    await f.owner.enqueue(input([file.fileRef]))
    await f.owner.settled()
    f.ports.retainedFileRefs = async () => { throw new Error('提交状态损坏') }
    const clock = vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 8 * 24 * 3600_000)
    try {
      await f.stage('during.pdf')
      expect((await f.owner.readLocal(file.fileRef)).file).toEqual(file)
      f.ports.retainedFileRefs = async () => []
      await f.stage('after.pdf')
      await expect(f.owner.readLocal(file.fileRef)).rejects.toMatchObject({ code: 'file-ref-invalid' })
    } finally { clock.mockRestore() }
  })
  it('stages locally without a cloud upload and rejects another account', async () => {
    const f = await fixture(); const file = await f.stage('one.pdf')
    expect(f.upload).not.toHaveBeenCalled()
    expect(JSON.stringify(file)).not.toContain(f.directory)
    expect((await f.owner.readLocal(file.fileRef)).file.size).toBe(10)
    f.setUser(43)
    await expect(f.owner.readLocal(file.fileRef)).rejects.toMatchObject({ code: 'file-ref-invalid' })
  })
  it('normalizes a browser file with missing MIME before classification and policy checks', async () => {
    const f = await fixture()
    const path = join(f.directory, 'photo.jpg')
    await writeFile(path, 'image-data')
    const image = await f.owner.stage(path, { fileName: 'photo.jpg', mimeType: 'application/octet-stream', size: 10 })

    expect(image).toMatchObject({ fileName: 'photo.jpg', mimeType: 'image/jpeg', fileKind: 1 })
    expect((await f.owner.readLocal(image.fileRef)).file).toMatchObject({ mimeType: 'image/jpeg', fileKind: 1 })
  })
  it('opens only the current account local file through the injected Host opener without exposing its path', async () => {
    const f = await fixture(); const file = await f.stage('open.pdf')
    await expect(f.owner.openLocal(file.fileRef)).resolves.toEqual({ opened: true, file })
    expect(f.openPath).toHaveBeenCalledOnce()
    expect(basename(f.openPath.mock.calls[0]![0])).toBe('open.pdf')
    expect(f.openPath.mock.calls[0]![0]).not.toBe((await f.owner.readLocal(file.fileRef)).path)
    expect(JSON.stringify(await f.owner.openLocal(file.fileRef))).not.toContain(f.directory)
    f.setUser(43)
    await expect(f.owner.openLocal(file.fileRef)).rejects.toMatchObject({ code: 'file-ref-invalid' })
  })
  it('preserves the original extension for native ZIP opening and sanitizes unsafe path characters', async () => {
    const f = await fixture()
    const source = join(f.directory, 'archive-source'); await writeFile(source, '0123456789')
    const file = await f.owner.stage(source, { fileName: '../MBTI:assets?.zip', mimeType: 'application/zip', size: 10 })

    await f.owner.openLocal(file.fileRef)

    expect(basename(f.openPath.mock.calls[0]![0])).toBe('_MBTI_assets_.zip')
    expect(f.openPath.mock.calls[0]![0]).toContain(join('42', '.open', file.fileRef))
  })
  it('keeps media presentation separate from browser inline-preview support', () => {
    expect(arkmePickedFileKind('image/svg+xml', 'diagram.svg')).toBe(1)
    expect(arkmePickedFileKind('image/heic', 'camera.heic')).toBe(1)
    expect(arkmePickedFileKind('video/x-matroska', 'movie.mkv')).toBe(3)
    expect(arkmePickedFileKind('image/png', 'renamed.dmg')).toBe(4)
    expect(arkmePickedFileKind('audio/mp4', 'recording.m4a')).toBe(4)
    expect(arkmePickedFileKind('image/jpeg', 'photo.jpg')).toBe(1)
    expect(arkmePickedFileKind('video/mp4', 'movie.mp4')).toBe(3)
    expect(arkmeCanInlineLocalFile('image/heic', 'camera.heic')).toBe(false)
    expect(arkmeCanInlineLocalFile('image/svg+xml', 'diagram.svg')).toBe(false)
    expect(arkmeCanInlineLocalFile('video/x-matroska', 'movie.mkv')).toBe(false)
    expect(arkmeCanInlineLocalFile('application/pdf', 'report.pdf')).toBe(false)
  })
  it('retains a successful sibling when another upload fails and retries with the same IDs', async () => {
    const f = await fixture(); const a = await f.stage('a.pdf'); const b = await f.stage('b.pdf')
    f.upload.mockImplementationOnce(async (_path, meta) => ({ ...meta, fileAssetUid: 'uploaded-a' }))
      .mockImplementationOnce(async (_path, _metadata, onProgress) => { onProgress({ phase: 'uploading', sentBytes: 8, totalBytes: 10 }); throw new Error('offline') })
    const task = await f.owner.enqueue(input([a.fileRef, b.fileRef]))
    await f.owner.settled()
    expect((await f.owner.tasks())[0]).toMatchObject({ state: 'failed', files: [{ asset: { fileAssetUid: 'uploaded-a' } }, {}] })
    expect(fileTaskTimelineItem((await f.owner.tasks())[0]!).contentBlocks?.every(block => block.uploadProgress === undefined)).toBe(true)
    expect((await f.owner.retry(task.taskRef)).files[1]!.progress).toMatchObject({ phase: 'preparing', sentBytes: 0 })
    await f.owner.settled()
    expect(f.upload).toHaveBeenCalledTimes(3)
    expect(f.send).toHaveBeenCalledTimes(1)
    expect(f.send.mock.calls[0]![0].recordUid).toBe(task.recordUid)
    expect((await f.owner.tasks())[0]!.state).toBe('sent')
  })
  it('uploads staged extension attachments in order and reuses successful siblings after a retry', async () => {
    const f = await fixture(); const a = await f.stage('a.pdf'); const b = await f.stage('b.pdf')
    f.upload.mockImplementationOnce(async (_path, meta) => ({ ...meta, fileAssetUid: 'uploaded-a' }))
      .mockImplementationOnce(async () => { throw new Error('offline') })

    await expect((f.owner as unknown as {
      uploadRefs(fileRefs: readonly string[]): Promise<Array<{ fileAssetUid: string }>>
    }).uploadRefs([a.fileRef, b.fileRef])).rejects.toThrow('offline')

    await expect((f.owner as unknown as {
      uploadRefs(fileRefs: readonly string[]): Promise<Array<{ fileAssetUid: string; fileName: string }>>
    }).uploadRefs([a.fileRef, b.fileRef])).resolves.toEqual([
      expect.objectContaining({ fileAssetUid: 'uploaded-a', fileName: 'a.pdf' }),
      expect.objectContaining({ fileAssetUid: 'asset-b.pdf', fileName: 'b.pdf' }),
    ])
    expect(f.upload).toHaveBeenCalledTimes(3)
    expect(f.send).not.toHaveBeenCalled()
  })
  it('persists one explicit background descriptor and reuses its uploaded asset on retry', async () => {
    const f = await fixture()
    const backgroundPath = join(f.directory, 'background.m4a'); await writeFile(backgroundPath, 'background')
    const background = await f.owner.stage(backgroundPath, { fileName: 'background.m4a', mimeType: 'audio/mp4', size: 10 })
    expect(background.fileKind).toBe(4)
    const normal = await f.stage('normal.pdf')
    f.upload.mockImplementationOnce(async (_path, meta) => ({ ...meta, fileAssetUid: 'uploaded-background' }))
      .mockRejectedValueOnce(new Error('offline'))
    const request = {
      ...input([background.fileRef, normal.fileRef]),
      backgroundSound: { fileRefs: [background.fileRef], amplitudes: [0.1, 0.7] },
    }

    const task = await f.owner.enqueue(request); await f.owner.settled()
    expect((await f.owner.tasks())[0]).toMatchObject({ state: 'failed', backgroundSound: request.backgroundSound })
    await f.owner.retry(task.taskRef); await f.owner.settled()

    expect(f.upload).toHaveBeenCalledTimes(3)
    expect(f.upload.mock.calls[0]![1]).toMatchObject({ fileName: 'background.m4a', fileKind: 2 })
    expect(f.upload.mock.calls[1]![1]).toMatchObject({ fileName: 'normal.pdf', fileKind: 4 })
    expect(f.upload.mock.calls[2]![1]).toMatchObject({ fileName: 'normal.pdf', fileKind: 4 })
    expect(f.send).toHaveBeenCalledWith(
      expect.objectContaining({ backgroundSound: request.backgroundSound }),
      expect.any(Array),
      { assets: [expect.objectContaining({ fileAssetUid: 'uploaded-background' })], amplitudes: [0.1, 0.7] },
      42,
      expect.any(AbortSignal),
    )
    expect((await f.owner.tasks())[0]).toMatchObject({ state: 'sent', backgroundSound: request.backgroundSound })
  })
  it('does not reuse a generic audio asset for the same file when it later has the background role', async () => {
    const f = await fixture()
    const audioPath = join(f.directory, 'dual-role.m4a'); await writeFile(audioPath, 'dual-role.')
    const audio = await f.owner.stage(audioPath, { fileName: 'dual-role.m4a', mimeType: 'audio/mp4', size: 10 })

    await f.owner.enqueue(input([audio.fileRef])); await f.owner.settled()
    await f.owner.enqueue({
      ...input([audio.fileRef]),
      recordUid: '00000000-0000-4000-8000-000000000003',
      relationUid: '00000000-0000-4000-8000-000000000004',
      backgroundSound: { fileRefs: [audio.fileRef], amplitudes: [0.3] },
    }); await f.owner.settled()

    expect(f.upload.mock.calls.map(call => call[1].fileKind)).toEqual([4, 2])
    expect(f.send).toHaveBeenCalledTimes(2)
  })
  it('aligns uploaded assets by local ref before splitting ordinary and background roles', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'arkme files owner ')); directories.push(directory)
    const sendSourceRich = vi.fn(async (sourceRef: string, _input: unknown, options: { recordUid: string }) => ({
      sourceRef, itemUid: options.recordUid, status: 1, localState: 'synced' as const,
    }))
    const saveMessageLocation = vi.fn(async () => undefined)
    const owner = createArkmeFileTransfers({
      directory,
      maxUploadBytes: 1_000,
      runtime: { requireSession: async () => ({ userId: 42 }), stateStore: { recordReeditFileRefs: async () => [] } } as never,
      source: { openSourceRef: async () => ({ kind: 'private_chat' }) } as never,
      media: { uploadLocalFile: async (_path: string, metadata: { fileName: string }) => ({
        ...metadata, fileAssetUid: `asset-${metadata.fileName}`,
      }) } as never,
      chat: { sendSourceRich, saveMessageLocation, readSource: async () => ({ items: [] }) } as never,
    })!
    const backgroundPath = join(directory, 'background.m4a'); await writeFile(backgroundPath, 'background')
    const normalPath = join(directory, 'normal.pdf'); await writeFile(normalPath, 'normal.pdf')
    const background = await owner.stage(backgroundPath, { fileName: 'background.m4a', mimeType: 'audio/mp4', size: 10 })
    const normal = await owner.stage(normalPath, { fileName: 'normal.pdf', mimeType: 'application/pdf', size: 10 })

    await owner.enqueue({
      ...input([background.fileRef, normal.fileRef]),
      backgroundSound: { fileRefs: [background.fileRef], amplitudes: [0.2, 0.9] },
      location: { latitude: 30.52, longitude: 114.31, accuracyMeters: 18, capturedAtMillis: 100 },
    })
    await owner.settled()

    expect(sendSourceRich).toHaveBeenCalledWith('source', expect.objectContaining({
      assets: [expect.objectContaining({ fileAssetUid: 'asset-normal.pdf' })],
      backgroundSound: {
        assets: [expect.objectContaining({ fileAssetUid: 'asset-background.m4a' })],
        amplitudes: [0.2, 0.9],
      },
    }), expect.objectContaining({
      recordUid: '00000000-0000-4000-8000-000000000001',
      relationUid: '00000000-0000-4000-8000-000000000002',
      expectedUserId: 42,
    }))
    expect(saveMessageLocation).toHaveBeenCalledWith(
      'source',
      '00000000-0000-4000-8000-000000000001',
      { latitude: 30.52, longitude: 114.31, accuracyMeters: 18, capturedAtMillis: 100 },
      undefined,
      { signal: expect.any(AbortSignal) },
    )
  })
  it('keeps a confirmed file message sent when only its location post-effect fails', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'arkme files location warning ')); directories.push(directory)
    const owner = createArkmeFileTransfers({
      directory,
      maxUploadBytes: 1_000,
      runtime: { requireSession: async () => ({ userId: 42 }), stateStore: { recordReeditFileRefs: async () => [] } } as never,
      source: { openSourceRef: async () => ({ kind: 'send_to_self' }) } as never,
      media: { uploadLocalFile: async (_path: string, metadata: { fileName: string }) => ({
        ...metadata, fileAssetUid: `asset-${metadata.fileName}`,
      }) } as never,
      chat: {
        sendSourceRich: async (_sourceRef: string, _input: unknown, options: { recordUid: string }) => ({
          sourceRef: 'source', itemUid: options.recordUid, status: 1, localState: 'synced' as const,
        }),
        saveMessageLocation: async () => { throw new ArkmePluginError('location-offline', '位置服务暂不可用', true, 502) },
        readSource: async () => ({ items: [] }),
      } as never,
    })!
    const sourcePath = join(directory, 'normal.pdf'); await writeFile(sourcePath, 'normal.pdf')
    const file = await owner.stage(sourcePath, { fileName: 'normal.pdf', mimeType: 'application/pdf', size: 10 })

    await owner.enqueue({
      ...input([file.fileRef]),
      location: { latitude: 30.52, longitude: 114.31, capturedAtMillis: 100 },
    })
    await owner.settled()

    expect((await owner.tasks())[0]).toMatchObject({
      state: 'sent',
      result: { localState: 'synced', warningText: '消息已发送，但位置快照未写入：位置服务暂不可用' },
    })
  })
  it('rejects invalid amplitudes, cross-task refs, and non-audio background files', async () => {
    const f = await fixture(); const ordinary = await f.stage('a.pdf')
    const foreignRef = 'arkme-file-v1.00000000-0000-4000-8000-000000000099'

    await expect(f.owner.enqueue({
      ...input([ordinary.fileRef]),
      backgroundSound: { fileRefs: [foreignRef], amplitudes: [0.5] },
    })).rejects.toMatchObject({ code: 'background-sound-invalid' })
    await expect(f.owner.enqueue({
      ...input([ordinary.fileRef]),
      backgroundSound: { fileRefs: [ordinary.fileRef], amplitudes: [Number.NaN] },
    })).rejects.toMatchObject({ code: 'background-sound-invalid' })
    await expect(f.owner.enqueue({
      ...input([ordinary.fileRef]),
      backgroundSound: { fileRefs: [ordinary.fileRef], amplitudes: [1.01] },
    })).rejects.toMatchObject({ code: 'background-sound-invalid' })
    await expect(f.owner.enqueue({
      ...input([ordinary.fileRef]),
      backgroundSound: { fileRefs: [ordinary.fileRef], amplitudes: Array.from({ length: 4_097 }, () => 0.5) },
    })).rejects.toMatchObject({ code: 'background-sound-invalid' })
    await expect(f.owner.enqueue({
      ...input([ordinary.fileRef]),
      backgroundSound: { fileRefs: [ordinary.fileRef], amplitudes: [0.5] },
    })).rejects.toMatchObject({ code: 'background-sound-file-invalid' })
    expect(f.upload).not.toHaveBeenCalled()
  })
  it('rejects a background-only file task before source validation, persistence, or upload', async () => {
    const f = await fixture()
    const path = join(f.directory, 'background-only.m4a'); await writeFile(path, 'background')
    const background = await f.owner.stage(path, { fileName: 'background-only.m4a', mimeType: 'audio/mp4', size: 10 })

    await expect(f.owner.enqueue({
      ...input([background.fileRef]),
      content: {},
      backgroundSound: { fileRefs: [background.fileRef], amplitudes: [0.2, 0.6] },
    })).rejects.toMatchObject({ code: 'file-send-background-only-invalid' })
    expect(f.validateSource).not.toHaveBeenCalled()
    expect(f.upload).not.toHaveBeenCalled()
    expect(await f.owner.tasks()).toEqual([])
  })
  it('fences a queued send to the account captured by the composer', async () => {
    const f = await fixture(); const file = await f.stage('a.pdf')
    f.setUser(43)

    await expect(f.owner.enqueue({ ...input([file.fileRef]), expectedUserId: 42 }))
      .rejects.toMatchObject({ code: 'file-account-changed' })
    expect(f.validateSource).not.toHaveBeenCalled()
    expect(f.upload).not.toHaveBeenCalled()
    expect(await f.owner.tasks()).toEqual([])
  })
  it('deduplicates repeated acceptance and restores uncertain submissions without resending', async () => {
    const f = await fixture(); const a = await f.stage('a.pdf')
    f.send.mockResolvedValueOnce({ kind: 'owner_outcome_unknown' })
    const request = input([a.fileRef])
    const task = await f.owner.enqueue(request); await f.owner.settled()
    expect((await f.owner.enqueue(request)).taskRef).toBe(task.taskRef)
    const restored = new FileTransfers(f.directory, f.ports, 1000)
    expect((await restored.tasks())[0]!.state).toBe('uncertain')
    await expect(restored.retry(task.taskRef)).rejects.toMatchObject({ code: 'file-send-uncertain' })
    expect(f.send).toHaveBeenCalledTimes(1)
  })
  it('keeps a definitive provider rejection retryable with its safe error instead of calling it uncertain', async () => {
    const f = await fixture(); const file = await f.stage('a.pdf')
    f.send.mockResolvedValueOnce({
      kind: 'owner_not_accepted', code: 'arkme-code-2002', message: 'json: unknown field "file_type"',
    })
    const task = await f.owner.enqueue(input([file.fileRef])); await f.owner.settled()

    expect((await f.owner.tasks())[0]).toMatchObject({
      state: 'failed', errorCode: 'arkme-code-2002', error: 'json: unknown field "file_type"',
    })
    await f.owner.retry(task.taskRef); await f.owner.settled()
    expect(f.upload).toHaveBeenCalledTimes(1)
    expect(f.send).toHaveBeenCalledTimes(2)
    expect((await f.owner.tasks())[0]).toMatchObject({ state: 'sent' })
    expect((await f.owner.tasks())[0]).not.toHaveProperty('errorCode')
  })
  it('persists terminal permission rejection and does not retry it after restart', async () => {
    const f = await fixture(); const file = await f.stage('a.pdf')
    f.send.mockResolvedValueOnce({ kind: 'owner_not_accepted', code: 'arkme-code-1004', message: '对方已拒收消息', retryable: false })
    const task = await f.owner.enqueue(input([file.fileRef])); await f.owner.settled()
    expect((await f.owner.tasks())[0]).toMatchObject({ state: 'failed', retryable: false })
    const restored = new FileTransfers(f.directory, f.ports, 1000)
    await expect(restored.retry(task.taskRef)).rejects.toMatchObject({ code: 'arkme-code-1004' })
    expect(f.send).toHaveBeenCalledTimes(1)
  })
  it('keeps a retryable send failure uncertain and preserves its safe code for reconciliation', async () => {
    const f = await fixture(); const file = await f.stage('a.pdf')
    f.send.mockResolvedValueOnce({
      kind: 'owner_outcome_unknown', code: 'arkme-timeout', message: 'Arkme 服务请求超时',
    })
    const task = await f.owner.enqueue(input([file.fileRef])); await f.owner.settled()

    expect((await f.owner.tasks())[0]).toMatchObject({
      state: 'uncertain', errorCode: 'arkme-timeout', error: 'Arkme 服务请求超时',
    })
    await expect(f.owner.retry(task.taskRef)).rejects.toMatchObject({ code: 'file-send-uncertain' })
    expect(f.send).toHaveBeenCalledTimes(1)
  })
  it('keeps a preflight send failure recoverable instead of treating it as an unknown acknowledgement', async () => {
    const f = await fixture(); const file = await f.stage('a.pdf')
    f.send.mockResolvedValueOnce({ kind: 'owner_not_accepted', message: '成员校验暂时不可用' })

    const task = await f.owner.enqueue(input([file.fileRef])); await f.owner.settled()

    expect((await f.owner.tasks())[0]).toMatchObject({
      taskRef: task.taskRef,
      state: 'failed',
      error: '成员校验暂时不可用',
    })
    await expect(f.owner.retry(task.taskRef)).resolves.toMatchObject({ state: 'queued' })
    await f.owner.settled()
    expect((await f.owner.tasks())[0]!.state).toBe('sent')
    expect(f.send).toHaveBeenCalledTimes(2)
  })
  it('keeps an explicit owner rejection recoverable after entering the send phase', async () => {
    const f = await fixture(); const file = await f.stage('a.pdf')
    f.send.mockResolvedValueOnce({ kind: 'owner_not_accepted', message: '媒体载荷不合法' })

    const task = await f.owner.enqueue(input([file.fileRef])); await f.owner.settled()

    expect((await f.owner.tasks())[0]).toMatchObject({
      taskRef: task.taskRef,
      state: 'failed',
      error: '媒体载荷不合法',
    })
    await expect(f.owner.retry(task.taskRef)).resolves.toMatchObject({ state: 'queued' })
    await f.owner.settled()
  })
  it('prevents a blind retry only when the owner write result is genuinely unknown', async () => {
    const f = await fixture(); const file = await f.stage('a.pdf')
    f.send.mockResolvedValueOnce({ kind: 'owner_outcome_unknown' })

    const task = await f.owner.enqueue(input([file.fileRef])); await f.owner.settled()

    expect((await f.owner.tasks())[0]).toMatchObject({ taskRef: task.taskRef, state: 'uncertain' })
    await expect(f.owner.retry(task.taskRef)).rejects.toMatchObject({ code: 'file-send-uncertain' })
  })
  it('fails closed when a send port violates the explicit owner-outcome contract', async () => {
    const f = await fixture(); const file = await f.stage('a.pdf')
    f.send.mockRejectedValueOnce(new Error('unexpected adapter failure'))

    const task = await f.owner.enqueue(input([file.fileRef])); await f.owner.settled()

    expect((await f.owner.tasks())[0]).toMatchObject({ taskRef: task.taskRef, state: 'uncertain' })
    await expect(f.owner.retry(task.taskRef)).rejects.toMatchObject({ code: 'file-send-uncertain' })
  })
  it('does not claim completion at the end of a PUT', () => {
    expect(arkmeVisibleUploadFraction({ phase: 'completing', sentBytes: 100, totalBytes: 100 })).toBe(.99)
    expect(arkmeVisibleUploadFraction({ phase: 'ready', sentBytes: 100, totalBytes: 100 })).toBe(1)
  })
  it('reconciles a lost acknowledgement without uploading or sending again', async () => {
    const f = await fixture(); const file = await f.stage('a.pdf')
    f.send.mockResolvedValueOnce({ kind: 'owner_outcome_unknown' })
    const task = await f.owner.enqueue(input([file.fileRef])); await f.owner.settled()
    f.ports.reconcile = vi.fn(async request => ({ sourceRef: request.sourceRef, itemUid: request.recordUid, status: 1, localState: 'synced' }))
    expect((await f.owner.reconcile(task.taskRef)).state).toBe('sent')
    expect(f.upload).toHaveBeenCalledTimes(1); expect(f.send).toHaveBeenCalledTimes(1)
  })
  it('does not interpret absence from a recent page as a rejected send', async () => {
    const f = await fixture(); const file = await f.stage('a.pdf')
    f.send.mockResolvedValueOnce({ kind: 'owner_outcome_unknown' })
    const task = await f.owner.enqueue(input([file.fileRef])); await f.owner.settled()
    f.ports.reconcile = async () => undefined
    expect((await f.owner.reconcile(task.taskRef)).state).toBe('uncertain')
    await expect(f.owner.retry(task.taskRef)).rejects.toMatchObject({ code: 'file-send-uncertain' })
  })
  it('deduplicates concurrent original reception and never promotes partial files', async () => {
    const f = await fixture()
    const ref = 'arkme-media-v1.fixture'
    let finish!: () => void
    f.ports.fetchMedia = vi.fn(async () => {
      await new Promise<void>(resolve => { finish = resolve })
      return { response: new Response('abc', { headers: { 'content-length': '5' } }), descriptor: { fileName: 'a.pdf', mimeType: 'application/pdf', size: 5 } }
    })
    await f.owner.reception(ref, true); await f.owner.reception(ref, true)
    expect(f.ports.fetchMedia).toHaveBeenCalledTimes(1)
    finish(); await f.owner.settled()
    expect(await f.owner.reception(ref)).toMatchObject({ state: 'failed' })
    expect(await f.owner.files()).toEqual([])
    f.ports.fetchMedia = vi.fn(async () => ({ response: new Response('abc'), descriptor: { fileName: 'a.pdf', mimeType: 'application/pdf', size: 3 } }))
    await f.owner.reception(ref, true); await f.owner.settled()
    expect(await f.owner.reception(ref)).toMatchObject({ state: 'ready', file: { size: 3 } })
    await f.owner.reception(ref, true)
    expect(f.ports.fetchMedia).toHaveBeenCalledTimes(1)
    f.setUser(43)
    expect(await f.owner.reception(ref)).toMatchObject({ state: 'missing' })
  })
  it('does not rebind a staged import or queued send to another account', async () => {
    const f = await fixture(); const file = await f.stage('a.pdf')
    const local = await f.owner.readLocal(file.fileRef)
    f.setUser(43)
    await expect(f.owner.stage(local.path, file, 42)).rejects.toMatchObject({ code: 'file-account-changed' })
    expect(await f.owner.files()).toEqual([])
    f.setUser(42)
    f.upload.mockImplementationOnce(async (_path, metadata) => { f.setUser(43); return { ...metadata, fileAssetUid: 'asset-12345678' } })
    await f.owner.enqueue(input([file.fileRef])); await f.owner.settled()
    expect(f.send).not.toHaveBeenCalled()
    f.setUser(42); expect((await f.owner.tasks())[0]!.state).toBe('failed')
  })
  it('accepts bounded bytes instead of arbitrary host paths and validates media headers', async () => {
    const f = await fixture()
    await expect(f.owner.stageBytes('/etc/passwd', { fileName: 'a.txt', mimeType: 'text/plain' })).rejects.toMatchObject({ code: 'file-tool-input-invalid' })
    await expect(f.owner.stageBytes('YWJj', { fileName: 'a.txt', mimeType: 'text/plain\r\nx-test: injected' })).rejects.toMatchObject({ code: 'file-input-invalid' })
    expect(await f.owner.stageBytes('YWJj', { fileName: 'a.txt', mimeType: 'text/plain' })).toMatchObject({ size: 3, fileKind: 4 })
    expect(f.upload).not.toHaveBeenCalled()
  })
  it('guards active references and removes only local tasks and unused files', async () => {
    const f = await fixture(); const file = await f.stage('a.pdf')
    const task = await f.owner.enqueue(input([file.fileRef])); await f.owner.settled()
    await expect(f.owner.remove(file.fileRef)).rejects.toMatchObject({ code: 'file-in-use' })
    await f.owner.discard(task.taskRef); await f.owner.remove(file.fileRef)
    expect(await f.owner.tasks()).toEqual([]); expect(await f.owner.files()).toEqual([])
    expect(f.send).toHaveBeenCalledTimes(1)
  })
  it('does not hide a terminal task in memory when its discard cannot be persisted', async () => {
    const f = await fixture(); const file = await f.stage('a.pdf')
    const task = await f.owner.enqueue(input([file.fileRef])); await f.owner.settled()
    const statePath = join(f.directory, '42', 'state.json')
    await rm(statePath)
    await mkdir(statePath)

    await expect(f.owner.discard(task.taskRef)).rejects.toBeDefined()

    expect(await f.owner.tasks()).toContainEqual(expect.objectContaining({ taskRef: task.taskRef, state: 'sent' }))
  })
})
