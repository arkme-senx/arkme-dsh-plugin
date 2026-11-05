import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { ToolCallId, createUserMessage, createToolResultMessage } from '@deepseek-ai/dsh-llm'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { createSessionInput } from './helpers/session-input.js'
import { registerArkmeTools } from '../src/tools/registry/registrar.js'
import { createArkmeSdk } from '../src/sdk/index.js'
import { dispatchArkmeHostOperation } from '../src/host-api.js'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { FileTransfers, type FileTransferPorts } from '../src/services/file-transfers.js'
import { ProgressiveAttachments, type AttachmentReceipt } from '../src/services/progressive-attachments.js'
import { ArkmePluginError } from '../src/services/service.js'

const roots: string[] = []
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))) })
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'progressive files ')); roots.push(root)
  let user = 7
  let receipts: AttachmentReceipt[] = []
  const events: string[] = []
  const send = vi.fn<FileTransferPorts['send']>(async (input, _assets, _background, _user, _signal, pending) => {
    events.push('send')
    receipts = pending!.map(file => ({ attachmentUid: file.attachmentUid, generation: file.generation, state: 'pending' }))
    return { kind: 'owner_accepted', result: { sourceRef: input.sourceRef, itemUid: input.recordUid, status: 1, localState: 'synced' } }
  })
  const upload = vi.fn<NonNullable<FileTransferPorts['progressive']>['upload']>(async (_path, file, _progress, _user, _signal, target) => {
    events.push('upload')
    const receipt = receipts.find(value => value.attachmentUid === target.attachment_uid)!
    receipt.state = 'ready'; receipt.fileAssetUid = `asset-${file.fileName}`
    return { ...file, fileAssetUid: receipt.fileAssetUid }
  })
  const retry = vi.fn(async (target) => {
    const receipt = receipts.find(value => value.attachmentUid === target.attachment_uid)!
    receipt.generation++; receipt.state = 'pending'
    return structuredClone(receipts)
  })
  const ports: FileTransferPorts = { currentUser: async () => user, validateSource: async () => {}, send,
    upload: vi.fn(async () => { throw new Error('legacy upload unexpected') }),
    fetchMedia: async () => { throw new Error('download unexpected') },
    progressive: { supported: async () => true, reconcile: async () => structuredClone(receipts), retry, upload },
  }
  const owner = new FileTransfers(root, ports, 1000)
  const files = await Promise.all(['a.png', 'b.mp4', 'c.pdf'].map(fileName => owner.stageBytes('aGVsbG8=', { fileName, mimeType: 'application/octet-stream' })))
  const input = { sourceRef: 'source', recordUid: '00000000-0000-4000-8000-000000000001', relationUid: '00000000-0000-4000-8000-000000000002', fileRefs: files.map(file => file.fileRef), content: { textContent: '先发消息' } }
  return { root, owner, ports, input, files, events, send, upload, retry, receipts: () => receipts, setUser: (value: number) => { user = value } }
}

it('sends image/video/file metadata before any bytes and exposes message receipt during upload', async () => {
  const f = await fixture()
  const original = f.upload.getMockImplementation()!
  f.upload.mockImplementation(async (...args) => {
    const tasks = await f.owner.tasks()
    expect(tasks[0]).toMatchObject({ state: 'uploading', result: { itemUid: f.input.recordUid } })
    return original(...args)
  })
  await f.owner.enqueue(f.input); await f.owner.settled()
  expect(f.events).toEqual(['send', 'upload', 'upload', 'upload'])
  expect(f.send.mock.calls[0]![5]?.map(file => file.fileKind)).toEqual([1, 3, 4])
  expect(await f.owner.tasks()).toMatchObject([{ state: 'sent', delivery: 'progressive' }])
})

it('persists accepted message and retries only unfinished attachments after restart', async () => {
  const f = await fixture()
  f.upload.mockRejectedValueOnce(new Error('offline'))
  const task = await f.owner.enqueue(f.input); await f.owner.settled()
  expect(await f.owner.tasks()).toMatchObject([{ state: 'failed', result: { itemUid: f.input.recordUid } }])
  const restarted = new FileTransfers(f.root, f.ports, 1000)
  await restarted.retry(task.taskRef); await restarted.settled()
  expect(f.send).toHaveBeenCalledTimes(1)
  expect(await restarted.tasks()).toMatchObject([{ state: 'sent' }])
})

it('does not upload after unknown send; exact reconciliation resumes without a new message', async () => {
  const f = await fixture()
  const send = f.send.getMockImplementation()!
  f.send.mockImplementationOnce(async (...args) => { await send(...args); return { kind: 'owner_outcome_unknown' } })
  const task = await f.owner.enqueue(f.input); await f.owner.settled()
  expect(f.upload).not.toHaveBeenCalled()
  await expect(f.owner.retry(task.taskRef)).rejects.toMatchObject({ code: 'file-send-uncertain' })
  f.ports.reconcile = async () => ({ sourceRef: f.input.sourceRef, itemUid: f.input.recordUid, status: 1, localState: 'synced' })
  await f.owner.reconcile(task.taskRef); await f.owner.settled()
  expect(f.send).toHaveBeenCalledTimes(1)
  expect(await f.owner.tasks()).toMatchObject([{ state: 'sent' }])
})

it('reconciles a completed upload after a lost acknowledgement without uploading again', async () => {
  const f = await fixture()
  const original = f.upload.getMockImplementation()!
  f.upload.mockImplementationOnce(async (...args) => { await original(...args); throw new Error('lost completion ACK') })
  const task = await f.owner.enqueue(f.input); await f.owner.settled()
  await f.owner.retry(task.taskRef); await f.owner.settled()
  expect(f.upload).toHaveBeenCalledTimes(3)
  expect(f.send).toHaveBeenCalledTimes(1)
})

it('uses server retry generation and never resurrects a removed attachment', async () => {
  const f = await fixture()
  f.upload.mockRejectedValueOnce(new Error('offline'))
  const task = await f.owner.enqueue(f.input); await f.owner.settled()
  f.receipts()[0]!.state = 'failed'; f.receipts().splice(1, 1)
  await f.owner.retry(task.taskRef); await f.owner.settled()
  expect(f.retry).toHaveBeenCalledTimes(1)
  expect(f.upload.mock.calls[1]![5].generation).toBe(2)
  expect(f.upload).toHaveBeenCalledTimes(3)
  expect(f.send).toHaveBeenCalledTimes(1)
})

it('persists completion recovery privately and does not expose it via list, retry or duplicate enqueue', async () => {
  const f = await fixture()
  f.upload.mockImplementationOnce(async (...args) => {
    await args[6].save({ upload_session_uid: 'session-private', storage_etag: 'etag-private', uploaded_size: 5, multipart_parts: [] })
    throw new Error('complete response lost')
  })
  const task = await f.owner.enqueue(f.input); await f.owner.settled()
  expect(JSON.stringify(await f.owner.tasks())).not.toContain('etag-private')
  expect(JSON.stringify(await f.owner.enqueue(f.input))).not.toContain('etag-private')
  const original = f.upload.getMockImplementation()!
  f.upload.mockImplementationOnce(async (...args) => {
    expect(args[6].read()?.storage_etag).toBe('etag-private')
    return original(...args)
  })
  const restarted = new FileTransfers(f.root, f.ports, 1000)
  expect(JSON.stringify(await restarted.retry(task.taskRef))).not.toContain('etag-private')
  await restarted.settled()
  expect(await restarted.tasks()).toMatchObject([{ state: 'sent' }])
})

it('account switching stops upload and cannot send or retry in another account', async () => {
  const f = await fixture()
  const original = f.send.getMockImplementation()!
  f.send.mockImplementationOnce(async (...args) => { const result = await original(...args); f.setUser(8); return result })
  const task = await f.owner.enqueue(f.input); await f.owner.settled()
  expect(f.upload).not.toHaveBeenCalled()
  await expect(f.owner.retry(task.taskRef)).rejects.toMatchObject({ code: 'file-task-missing' })
})

it('discards completion receipts from an older server generation', async () => {
  const f = await fixture()
  f.upload.mockImplementationOnce(async (...args) => {
    await args[6].save({ upload_session_uid: 'old-session', storage_etag: 'etag', uploaded_size: 5, multipart_parts: [] })
    throw new Error('offline')
  })
  const task = await f.owner.enqueue(f.input); await f.owner.settled()
  f.receipts()[0]!.generation++
  const original = f.upload.getMockImplementation()!
  f.upload.mockImplementationOnce(async (...args) => {
    expect(args[5].generation).toBe(2)
    expect(args[6].read()).toBeUndefined()
    return original(...args)
  })
  await f.owner.retry(task.taskRef); await f.owner.settled()
  expect(f.send).toHaveBeenCalledTimes(1)
  expect(await f.owner.tasks()).toMatchObject([{ state: 'sent' }])
})

it('only explicit unsupported responses allow fallback; transient capability failures preserve the task', async () => {
  const session = { userId: 7 }
  const post = vi.fn(async () => ({ version: 1, metadata_first_version: 2 }))
  const owner = new ProgressiveAttachments({ requireSession: async () => session, authenticatedPost: post, authenticatedChatPost: post } as never)
  expect(await owner.supported(7, new AbortController().signal)).toBe(true)
  post.mockRejectedValueOnce(new ArkmePluginError('old', 'old', false, 404))
  expect(await owner.supported(7, new AbortController().signal)).toBe(false)
  post.mockRejectedValueOnce(new Error('timeout'))
  await expect(owner.supported(7, new AbortController().signal)).rejects.toThrow('timeout')
})

it('accepts owner removal and omitted empty media_refs but rejects a missing receipt payload', async () => {
  const post = vi.fn()
  const owner = new ProgressiveAttachments({ requireSession: async () => ({ userId: 7 }), authenticatedPost: post } as never)
  const signal = new AbortController().signal
  for (const result of [{ state: 'removed' }, { content_payload: null }, { content_payload: { schema_version: 1, payload_kind: 1 } }]) {
    post.mockResolvedValueOnce(result)
    expect(await owner.reconcile('record', 7, signal)).toEqual([])
  }
  for (const result of [{}, { content_payload: {} }, { content_payload: { media_refs: 'invalid' } },
    { content_payload: { media_refs: [{ upload: { generation: 1, state: 'pending' } }] } },
    { content_payload: { media_refs: [{ file_asset_uid: 123, upload: { attachment_uid: 'slot', generation: 1, state: 'ready' } }] } },
  ]) {
    post.mockResolvedValueOnce(result)
    await expect(owner.reconcile('record', 7, signal)).rejects.toMatchObject({ code: 'attachment-receipt-invalid' })
  }
})

it('allows the next message body while the first upload is blocked, with one upload at a time', async () => {
  const f = await fixture()
  let release!: () => void
  const gate = new Promise<void>(resolve => { release = resolve })
  const original = f.upload.getMockImplementation()!
  const originalSend = f.send.getMockImplementation()!
  // Keep the first message's receipts while the second body is admitted.
  f.send.mockImplementation(async (...args) => {
    const existing = [...f.receipts()]
    const result = await originalSend(...args)
    f.receipts().push(...existing)
    return result
  })
  let started!: () => void
  const uploading = new Promise<void>(resolve => { started = resolve })
  f.upload.mockImplementationOnce(async (...args) => { started(); await gate; return original(...args) })
  await f.owner.enqueue(f.input)
  await uploading
  try {
    await f.owner.enqueue({ ...f.input, recordUid: '00000000-0000-4000-8000-000000000003', relationUid: '00000000-0000-4000-8000-000000000004' })
    await vi.waitFor(() => expect(f.send).toHaveBeenCalledTimes(2))
    expect(f.upload).toHaveBeenCalledTimes(1)
  } finally { release(); await f.owner.settled() }
  expect(await f.owner.tasks()).toMatchObject([{ state: 'sent' }, { state: 'sent' }])
})

it('official DSH session confirmation and public SDK share the same durable send owner', async () => {
  const f = await fixture()
  const facade = { fileCapabilities: f.owner.capabilities.bind(f.owner), fileList: f.owner.files.bind(f.owner),
    fileSend: f.owner.enqueue.bind(f.owner), fileSendTasks: f.owner.tasks.bind(f.owner), fileSendRetry: f.owner.retry.bind(f.owner) }
  const sdk = createArkmeSdk({ fetchImpl: async (_url, init) => {
    const request = JSON.parse(String(init?.body))
    return new Response(JSON.stringify({ ok: true, value: await dispatchArkmeHostOperation(facade as never, request.operation, request.params) }))
  } })
  expect((await sdk.fileCapabilities()).metadataFirstVersion).toBe(2)
  const task = await sdk.sendFiles(f.input); await f.owner.settled()
  expect(await sdk.fileSendTasks()).toMatchObject([{ taskRef: task.taskRef, state: 'sent' }])
  const ctx = new Context(); await ctx.plugin(SystemPrompt); await ctx.plugin(ToolRuntime)
  const mounted = await ctx.plugin(Object.assign((inner: Context) => registerArkmeTools(inner, facade as never), { inject: ['tools', 'systemPrompt'] }))
  const session = Session.create(SessionId('progressive-files-session'))
  const inbox = createSessionInput(session), agent = { id: session.id, session, inbox } as unknown as Agent
  let count = 0
  const invoke = async (name: string, args: Record<string, unknown>) => {
    const callId = ToolCallId(`files-${++count}`)
    const call = session.append('tool/call', { turn: 1, step: count, callId, name, arguments: JSON.stringify(args) })
    const result = await ctx.tools.execute({ callId, name, arguments: args, agent, signal: new AbortController().signal })
    session.append('tool/result', { turn: 1, step: count, message: createToolResultMessage({ callId, content: result.content, isError: result.isError }) }, { surfaceOp: 'append', sourceEventSeqs: [call.seq] })
    return result
  }
  try {
    expect(ctx.tools.schemas(agent).map(tool => tool.name)).toEqual(expect.arrayContaining(['arkme_files_send', 'arkme_files_list', 'arkme_file_task']))
    const args = { source_ref: 'source', file_refs: f.input.fileRefs, text: '会话工具附件' }
    expect(JSON.stringify(await invoke('arkme_files_send', args))).toContain('confirmation_required')
    expect(f.send).toHaveBeenCalledTimes(1)
    inbox.append('next-step', createUserMessage({ content: [{ type: 'text', text: '确认发送这些附件' }], source: { kind: 'user' } }))
    for (const message of inbox.claim('next-step', 0)) session.append('user/message', message, { surfaceOp: 'append' })
    expect((await invoke('arkme_files_send', args)).isError).toBe(false)
    await f.owner.settled()
    expect(f.send).toHaveBeenCalledTimes(2)
    const listed = await invoke('arkme_files_list', {})
    expect(listed.isError).toBe(false)
    expect(JSON.stringify(listed)).toContain('progressive')
    expect(JSON.stringify(listed)).not.toContain(f.root)
  } finally { await mounted.dispose(); await ctx.fiber.dispose(); sdk.dispose() }
})

it('keeps unknown sends uncertain when saving the outcome fails', async () => {
  const f = await fixture()
  f.send.mockResolvedValueOnce({ kind: 'owner_outcome_unknown' })
  const storage = f.owner as unknown as { save(userId: number, state: { tasks: Array<{ state: string }> }): Promise<void> }
  const save = storage.save.bind(storage)
  vi.spyOn(storage, 'save').mockImplementation(async (userId, state) => {
    if (state.tasks.some(task => task.state === 'uncertain')) throw new Error('disk full')
    return save(userId, state)
  })
  const task = await f.owner.enqueue(f.input); await f.owner.settled()
  expect(await f.owner.tasks()).toMatchObject([{ state: 'uncertain' }])
  await expect(f.owner.retry(task.taskRef)).rejects.toMatchObject({ code: 'file-send-uncertain' })
  expect(f.upload).not.toHaveBeenCalled()
})

it('negotiates again after restarting a task whose capability request failed', async () => {
  const f = await fixture()
  f.ports.progressive!.supported = vi.fn().mockRejectedValueOnce(new Error('timeout')).mockResolvedValue(true)
  const task = await f.owner.enqueue(f.input); await f.owner.settled()
  const restarted = new FileTransfers(f.root, f.ports, 1000)
  await restarted.retry(task.taskRef); await restarted.settled()
  expect(f.ports.progressive!.supported).toHaveBeenCalledTimes(2)
  expect(f.send).toHaveBeenCalledTimes(1)
  expect(await restarted.tasks()).toMatchObject([{ state: 'sent', delivery: 'progressive' }])
})
