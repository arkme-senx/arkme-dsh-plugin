import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { FileTransfers, type FileTransferPorts } from '../src/services/file-transfers.js'
import { ArkmePluginError } from '../src/services/service.js'
import { ChatService } from '../src/services/chat-service.js'
import { createArkmeFileTransfers } from '../src/file-transfer-owner.js'
import type { ArkmeFileSendTask } from '../src/file-transfer-contract.js'

const owners: FileTransfers[] = [], directories: string[] = []
afterEach(async () => { for (const owner of owners.splice(0)) owner.dispose(); vi.useRealTimers(); for (const path of directories.splice(0)) await rm(path, { recursive: true, force: true }) })
const input = { sourceRef: 'topic', recordUid: '00000000-0000-4000-8000-000000000001', relationUid: '00000000-0000-4000-8000-000000000002', fileRefs: [], content: { textContent: '保留同一条消息', sendAtMillis: 1000 } }
async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'arkme message recovery ')); directories.push(directory)
  let user = 42
  const send = vi.fn<FileTransferPorts['send']>(async request => ({ kind: 'owner_accepted', result: { sourceRef: request.sourceRef, itemUid: request.recordUid, status: 1, localState: 'synced' } }))
  const reconcile = vi.fn<NonNullable<FileTransferPorts['reconcile']>>(async () => undefined)
  const ports: FileTransferPorts = { currentUser: async () => user, validateSource: async ref => ref === 'renamed-topic' ? 'topic' : ref, send, reconcile,
    upload: async () => { throw Error('文字不应上传附件') }, fetchMedia: async () => { throw Error('unexpected download') } }
  const make = () => { const owner = new FileTransfers(directory, ports, 1000); owners.push(owner); return owner }
  return { directory, make, owner: make(), ports, send, reconcile, setUser: (value: number) => { user = value } }
}
it('durably accepts text and freezes its identity/time before the first remote write', async () => {
  const f = await fixture()
  f.send.mockImplementation(async request => {
    const state = JSON.parse(await readFile(join(f.directory, '42', 'text-sends.json'), 'utf8'))
    expect(state.tasks[0]).toMatchObject({ recordUid: input.recordUid, state: 'sending', content: input.content })
    return { kind: 'owner_accepted', result: { sourceRef: request.sourceRef, itemUid: request.recordUid, status: 1, localState: 'synced' } }
  })
  const task = await f.owner.enqueue(input); await f.owner.settled()
  expect((await f.owner.tasks())[0]).toMatchObject({ taskRef: task.taskRef, state: 'sent', content: { sendAtMillis: 1000 } })
  expect(await readFile(join(f.directory, '42', 'text-sends.json'), 'utf8')).not.toContain(input.content.textContent)
  expect(await f.owner.tasks('topic', [])).toEqual([])
  expect(await f.owner.tasks('topic', [task.taskRef])).toMatchObject([{ state: 'sent', content: {} }])
  expect(await f.owner.tasks('renamed-topic')).toMatchObject([{ taskRef: task.taskRef, sourceRef: 'renamed-topic', result: { sourceRef: 'renamed-topic' } }])
  expect(await f.owner.tasks('other-topic')).toEqual([])
  await expect(f.owner.enqueue({ ...input, sourceRef: 'renamed-topic' })).resolves.toMatchObject({ taskRef: task.taskRef })
  await expect(f.owner.enqueue({ ...input, content: { textContent: '不同的内容', sendAtMillis: 1000 } })).rejects.toMatchObject({ code: 'file-send-conflict' })
  await expect(f.owner.enqueue({ ...input, recordUid: crypto.randomUUID(), content: { textContent: '' } })).rejects.toMatchObject({ code: 'file-send-invalid' })
})
it('sends text while a legacy attachment upload is blocked and polls only active status', async () => {
  const f = await fixture()
  let start!: () => void, release!: () => void
  const started = new Promise<void>(resolve => { start = resolve })
  const gate = new Promise<void>(resolve => { release = resolve })
  f.ports.upload = async () => {
    start()
    await gate
    return { fileAssetUid: 'uploaded', fileName: 'slow.txt', mimeType: 'text/plain', size: 4, fileKind: 4 }
  }
  const file = await f.owner.stageBytes(Buffer.from('slow').toString('base64'), { fileName: 'slow.txt', mimeType: 'text/plain' })
  try {
    const attachment = await f.owner.enqueue({ ...input, recordUid: crypto.randomUUID(), fileRefs: [file.fileRef] })
    await started
    const text = await f.owner.enqueue(input)
    await vi.waitFor(async () => expect((await f.owner.tasks('topic')).find(task => task.taskRef === text.taskRef)?.state).toBe('sent'))
    expect(f.send.mock.calls.map(([request]) => request.recordUid)).toEqual([text.recordUid])
    const poll = await f.owner.tasks('topic', [attachment.taskRef])
    expect(poll.map(task => [task.taskRef, task.state, task.content])).toEqual([[attachment.taskRef, 'uploading', {}]])
  } finally { release(); await f.owner.settled() }
})

it('migrates the old ledger once and keeps later text writes out of historical attachment state', async () => {
  const f = await fixture()
  const account = join(f.directory, '42')
  await mkdir(account, { recursive: true })
  const oldText = { ...input, taskRef: 'old-text', state: 'sent', files: [], createdAtMillis: 1000 }
  const oldFile = { ...input, taskRef: 'old-file', recordUid: crypto.randomUUID(), state: 'sent', files: [],
    fileRefs: ['arkme-file-v1.' + crypto.randomUUID()], createdAtMillis: 1000 }
  const fileState = join(account, 'state.json')
  const textState = join(account, 'text-sends.json')
  await writeFile(fileState, JSON.stringify({ version: 1, files: {}, originals: {}, tasks: [oldFile, oldText] }))
  expect((await f.owner.tasks()).map(task => task.taskRef)).toEqual(['old-file', 'old-text'])
  const migratedFiles = await readFile(fileState, 'utf8')
  expect(JSON.parse(migratedFiles).tasks.map((task: {taskRef: string}) => task.taskRef)).toEqual(['old-file'])
  expect(JSON.parse(await readFile(textState, 'utf8')).tasks[0]).toMatchObject({ taskRef: 'old-text', content: { sendAtMillis: 1000 } })
  await f.owner.enqueue({ ...input, recordUid: crypto.randomUUID() })
  await f.owner.settled()
  expect(await readFile(fileState, 'utf8')).toBe(migratedFiles)
  expect((await f.make().tasks()).filter(task => task.state === 'sent')).toHaveLength(3)
})

it('checks restored browser admissions without a retained local receipt before issuing a write', async () => {
  const f = await fixture()
  await expect(f.owner.enqueue(input, {})).rejects.toMatchObject({ code: 'file-send-uncertain' })
  expect(await f.owner.tasks()).toEqual([])
  f.reconcile.mockResolvedValueOnce({ sourceRef: input.sourceRef, itemUid: input.recordUid, status: 1, localState: 'synced' })
  const recovered = await f.owner.enqueue(input, {})
  expect(recovered).toMatchObject({ state: 'sent', content: { sendAtMillis: 1000 } })
  expect(recovered.content.textContent).toBeUndefined()
  expect(f.send).not.toHaveBeenCalled()
  expect((await f.owner.enqueue(input, {})).taskRef).toBe(recovered.taskRef)
  expect(f.reconcile).toHaveBeenCalledTimes(2)
  f.reconcile.mockResolvedValueOnce(null)
  await f.owner.enqueue({ ...input, recordUid: crypto.randomUUID() }, {})
  await f.owner.settled()
  expect(f.send).toHaveBeenCalledOnce()
})

it('backs off a transient rejection and manually retries the same frozen request only once', async () => {
  const f = await fixture(); vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
  f.send.mockResolvedValueOnce({ kind: 'owner_not_accepted', message: '暂时繁忙', code: 'arkme-http-503', retryable: true })
  const task = await f.owner.enqueue(input); await f.owner.settled()
  expect(f.send).toHaveBeenCalledTimes(1)
  expect((await f.owner.tasks())[0]).toMatchObject({ state: 'failed', nextRetryAtMillis: expect.any(Number) })
  await Promise.all([f.owner.retry(task.taskRef), f.owner.retry(task.taskRef)])
  await f.owner.settled(); await vi.advanceTimersByTimeAsync(2000)
  expect(f.send).toHaveBeenCalledTimes(2)
  expect(f.send.mock.calls[0]![0].content).toEqual(f.send.mock.calls[1]![0].content)
  expect((await f.owner.tasks())[0]!.state).toBe('sent')
})

it('waits for failure persistence before scheduling a single manual retry', async () => {
  const f = await fixture()
  f.send.mockResolvedValueOnce({ kind: 'owner_not_accepted', message: '暂时繁忙', retryable: true })
  const persistence = f.owner as unknown as { saveTask(userId: number, state: unknown, task: ArkmeFileSendTask): Promise<void> }
  const saveTask = persistence.saveTask.bind(persistence)
  const failed = Promise.withResolvers<void>()
  const release = Promise.withResolvers<void>()
  vi.spyOn(persistence, 'saveTask').mockImplementation(async (userId, state, task) => {
    if (task.state === 'failed') {
      failed.resolve()
      await release.promise
    }
    await saveTask(userId, state, task)
  })
  const task = await f.owner.enqueue(input)
  await failed.promise
  const retries = Promise.all([f.owner.retry(task.taskRef), f.owner.retry(task.taskRef)])
  try {
    await new Promise<void>(resolve => setImmediate(resolve))
    expect((await f.owner.tasks())[0]?.state).toBe('failed')
  } finally {
    release.resolve()
    await retries
    await f.owner.settled()
  }
  expect(f.send).toHaveBeenCalledTimes(2)
  expect((await f.owner.tasks())[0]).toMatchObject({ taskRef: task.taskRef, state: 'sent' })
})

it('delivers plain queued notes with rich media disabled and keeps rich content gated', async () => {
  const f = await fixture()
  const runtime = { config: { richMediaSendEnabled: false, maxTextLength: 20_000 }, requireSession: async () => ({ userId: 42 }) }
  const source = { openSourceRef: async () => ({ kind: 'send_to_self', ownerRef: 'self' }), sourceScopeKey: async () => 'self' }
  const createPersonalRecord = vi.fn(async () => ({ record_uid: input.recordUid, status: 1 }))
  const chat = Object.assign(Object.create(ChatService.prototype) as ChatService, {
    runtime, source, profile: {},
    record: { createPersonalRecord },
    realtime: { invalidateRecordProjection: async () => {} },
    withConfirmedSendReferences: async (result: unknown) => result,
  })
  const owner = createArkmeFileTransfers({
    directory: f.directory, maxUploadBytes: 1024, chat,
    runtime: runtime as unknown as Parameters<typeof createArkmeFileTransfers>[0]['runtime'],
    source: source as unknown as Parameters<typeof createArkmeFileTransfers>[0]['source'],
    media: {} as Parameters<typeof createArkmeFileTransfers>[0]['media'],
  })!
  owners.push(owner)
  await owner.enqueue(input)
  await owner.settled()
  expect((await owner.tasks())[0]).toMatchObject({ state: 'sent', result: { itemUid: input.recordUid } })
  expect(createPersonalRecord).toHaveBeenCalledWith('/api/v1/records/create', expect.objectContaining({
    record_uid: input.recordUid, send_at: 1000, text_content: input.content.textContent,
  }), expect.anything(), expect.any(AbortSignal), { trackWriteOutcome: true })

  const markdown = await owner.enqueue({ ...input, recordUid: crypto.randomUUID(), content: { ...input.content, textFormat: 'markdown' } })
  await owner.settled()
  expect((await owner.tasks()).find(task => task.taskRef === markdown.taskRef)).toMatchObject({
    state: 'failed', errorCode: 'rich-content-disabled', retryable: false,
  })
  await expect(chat.sendSourceRich(input.sourceRef, input.content)).rejects.toMatchObject({ code: 'rich-content-disabled' })
  expect(createPersonalRecord).toHaveBeenCalledOnce()
})
it('reconciles an acknowledged write without resending, and does not replay an inconclusive read', async () => {
  const f = await fixture(); vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
  f.send.mockResolvedValue({ kind: 'owner_outcome_unknown', code: 'arkme-network-error', message: '连接中断' })
  const task = await f.owner.enqueue(input); await f.owner.settled()
  await vi.advanceTimersByTimeAsync(2000); await f.owner.settled()
  expect(f.reconcile).toHaveBeenCalledOnce(); expect(f.send).toHaveBeenCalledOnce()
  f.reconcile.mockResolvedValue({ sourceRef: input.sourceRef, itemUid: input.recordUid, status: 1, localState: 'synced' })
  await f.owner.retry(task.taskRef); await f.owner.settled()
  expect(f.send).toHaveBeenCalledOnce(); expect((await f.owner.tasks())[0]!.state).toBe('sent')
})
it('replays after an exact negative receipt, but preserves terminal rejection', async () => {
  const f = await fixture(); vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
  f.send.mockResolvedValueOnce({ kind: 'owner_outcome_unknown', code: 'arkme-timeout' })
  f.reconcile.mockResolvedValue(null)
  await f.owner.enqueue(input); await f.owner.settled()
  await vi.advanceTimersByTimeAsync(2000); await f.owner.settled()
  expect(f.send).toHaveBeenCalledTimes(2)
  f.send.mockResolvedValue({ kind: 'owner_not_accepted', code: 'permission-denied', message: '无权发送', retryable: false })
  const task = await f.owner.enqueue({ ...input, recordUid: crypto.randomUUID() }); await f.owner.settled()
  await vi.advanceTimersByTimeAsync(120000)
  expect(f.send).toHaveBeenCalledTimes(3)
  await expect(f.owner.retry(task.taskRef)).rejects.toMatchObject({ code: 'permission-denied' })
})
it('restores queued recovery after restart and stops timers/work on account change or disposal', async () => {
  const f = await fixture(); vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
  f.send.mockResolvedValueOnce({ kind: 'owner_not_accepted', code: 'arkme-network-error', message: 'offline', retryable: true })
  await f.owner.enqueue(input); await f.owner.settled(); f.owner.dispose()
  const restarted = f.make(); await restarted.resume()
  await vi.advanceTimersByTimeAsync(2000); await restarted.settled()
  expect(f.send).toHaveBeenCalledTimes(2)
  f.send.mockResolvedValue({ kind: 'owner_not_accepted', code: 'arkme-network-error', message: 'offline', retryable: true })
  await restarted.enqueue({ ...input, recordUid: crypto.randomUUID() }); await restarted.settled()
  f.setUser(99); restarted.cancelActive(); await vi.advanceTimersByTimeAsync(120000)
  expect(await restarted.tasks()).toEqual([]); expect(f.send).toHaveBeenCalledTimes(3)
  restarted.dispose(); expect(vi.getTimerCount()).toBe(0)
})
it('caps automatic recovery at six attempts and keeps unsent content for an explicit retry', async () => {
  const f = await fixture(); vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
  f.send.mockResolvedValue({ kind: 'owner_not_accepted', code: 'arkme-network-error', message: 'offline', retryable: true })
  const task = await f.owner.enqueue(input); await f.owner.settled()
  for (const delay of [2000, 4000, 8000, 16000, 32000, 60000]) { await vi.advanceTimersByTimeAsync(delay); await f.owner.settled() }
  expect(f.send).toHaveBeenCalledTimes(7); expect((await f.owner.tasks())[0]).toMatchObject({ state: 'failed', content: input.content })
  await vi.advanceTimersByTimeAsync(600000); expect(f.send).toHaveBeenCalledTimes(7)
  await f.owner.retry(task.taskRef); await f.owner.settled(); expect(f.send).toHaveBeenCalledTimes(8)
})
it('honors Retry-After and stops recovery when the account disappears', async () => {
  const f = await fixture(); vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
  f.send.mockResolvedValueOnce({ kind: 'owner_not_accepted', code: 'arkme-http-429', message: 'rate limited', retryable: true, retryAfterMillis: 10_000 })
  await f.owner.enqueue(input); await f.owner.settled()
  await vi.advanceTimersByTimeAsync(9999); expect(f.send).toHaveBeenCalledOnce()
  f.setUser(99); await vi.advanceTimersByTimeAsync(1); await f.owner.settled()
  expect(f.send).toHaveBeenCalledOnce(); expect(vi.getTimerCount()).toBe(0)
})
it('recognizes only an exact missing Record as a negative receipt', async () => {
  const post = vi.fn()
  const service = {
    runtime: { requireSession: async () => ({ userId: 42 }), authenticatedPost: post },
    source: { openSourceRef: async () => ({ kind: 'topic', ownerRef: 'topic' }) },
  } as unknown as ChatService
  const check = () => ChatService.prototype.confirmSourceSend.call(service, input)
  post.mockRejectedValueOnce(new ArkmePluginError('arkme-code-40001', 'record is not found（服务错误码 40001）', false, 502))
  await expect(check()).resolves.toBe(false)
  post.mockRejectedValueOnce(new ArkmePluginError('arkme-code-40001', 'record is private', false, 502))
  await expect(check()).rejects.toMatchObject({ code: 'arkme-code-40001' })
  post.mockResolvedValueOnce({ record_core: { record_uid: input.recordUid, owner_user_id: 99, status: 1 } })
  await expect(check()).rejects.toMatchObject({ code: 'record-send-receipt-unverified' })
  post.mockResolvedValueOnce({ record_core: { record_uid: input.recordUid, owner_user_id: 42, status: 1 } })
  await expect(check()).resolves.toMatchObject({ itemUid: input.recordUid, localState: 'synced' })
})
