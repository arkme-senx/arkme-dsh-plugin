import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ArkmeSourceMessageExtendResult } from '../src/types.js'
const mocks = vi.hoisted(() => ({ call: vi.fn(), guard: vi.fn(), remove: vi.fn() }))
vi.mock('../src/client/api.js', () => ({ callArkme: mocks.call }))
vi.mock('../src/client/social-action-guard.js', () => ({ requirePhoneForSocialAction: mocks.guard }))
vi.mock('../src/sdk/index.js', () => ({ createArkmeSdk: () => ({ removeLocalFile: mocks.remove }) }))
import { arkmeAuthStore } from '../src/client/auth-store.js'
import { DetailExtensionSendQueue, detailExtensionSendTimelineItem, type DetailExtensionSend } from '../src/client/detail-extension-send.js'
const input: Omit<DetailExtensionSend, 'state'> = {
  accountKey: 'test:11', sourceKey: 'self', sourceRef: 'opaque-source', sourceKind: 'send_to_self', rootRecordUid: 'parent',
  parent: { itemUid: 'parent', senderName: '我', isMe: true, sendAtMillis: 1, title: '', textContent: '原消息', status: 1 },
  messageActionRef: 'opaque-action', recordUid: 'record', relationUid: 'relation', textContent: '延展', fileRefs: ['file-ref'],
  extension: { recordUid: 'record', parentRecordUid: 'parent', level: 2, senderDisplayName: '我', title: '', textContent: '延展',
    sendAtMillis: 2, templateKind: 1, displayKind: 0, officialMark: 0, mediaItems: [] },
}
const result: ArkmeSourceMessageExtendResult = { recordUid: 'record', parentRecordUid: 'parent', relationUid: 'relation', status: 1, localState: 'synced', extension: input.extension }
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve() }
function journal() { const data = new Map<string, string>(); return { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value) } } }

describe('independent detail extension sends', () => {
  beforeEach(() => { mocks.call.mockReset(); mocks.guard.mockReset(); mocks.remove.mockReset(); arkmeAuthStore.setAuth({ status: 'authenticated', environment: 'test', userId: 11 }) })
  it('publishes before provider work, scopes both views, and keeps one UID after confirmation', async () => {
    const queue = new DetailExtensionSendQueue()
    let finish!: (value: ArkmeSourceMessageExtendResult) => void
    mocks.call.mockImplementation(() => new Promise(resolve => { finish = resolve }))
    const task = queue.enqueue(input)
    expect(mocks.call).not.toHaveBeenCalled()
    expect(queue.views('test:11', 'self')).toEqual([task])
    expect(queue.views('test:12', 'self')).toEqual([])
    expect(queue.views('test:11', 'topic')).toEqual([])
    expect(detailExtensionSendTimelineItem(task)).toMatchObject({ itemUid: 'record', status: 0, extensionParentRecordUid: 'parent' })
    expect(() => queue.enqueue(input)).toThrow('重复')
    await flush()
    expect(mocks.remove).not.toHaveBeenCalled()
    finish(result); await flush()
    expect(detailExtensionSendTimelineItem(task)).toMatchObject({ itemUid: 'record', status: 1 })
    expect(task.state).toBe('sent')
    expect(mocks.remove).toHaveBeenCalledWith('file-ref')
    queue.acknowledge(task)
    expect(queue.views('test:11', 'self')).toEqual([])
  })
  it('keeps an unknown outcome and files, then reconciles without a duplicate write', async () => {
    const queue = new DetailExtensionSendQueue()
    let visible = false
    mocks.call.mockImplementation(async operation => {
      if (operation === 'source.message-extension.extend') throw new Error('响应丢失')
      return { parentRecordUid: 'parent', extensions: visible ? [input.extension] : [] }
    })
    const task = queue.enqueue(input); await flush()
    expect(task.state).toBe('uncertain')
    expect(mocks.remove).not.toHaveBeenCalled()
    queue.retry(task); await flush()
    expect(mocks.call.mock.calls.filter(([operation]) => operation === 'source.message-extension.extend')).toHaveLength(1)
    visible = true
    await queue.reconcile(task)
    expect(task.state).toBe('sent')
    expect(mocks.remove).toHaveBeenCalledWith('file-ref')
  })
  it('allows a proven pre-write failure to retry with its original IDs', async () => {
    const queue = new DetailExtensionSendQueue()
    mocks.guard.mockRejectedValueOnce(new Error('请绑定手机号')).mockResolvedValue(undefined)
    mocks.call.mockResolvedValue(result)
    const task = queue.enqueue({ ...input, sourceKind: 'private_chat' }); await flush()
    expect(task.state).toBe('failed')
    expect(mocks.call).not.toHaveBeenCalled()
    queue.retry(task); await flush()
    expect(task.state).toBe('sent')
    expect(mocks.call).toHaveBeenCalledWith('source.message-extension.extend', expect.objectContaining({ recordUid: 'record', relationUid: 'relation' }), expect.any(AbortSignal))
  })
  it('stops before a write if the account changes during role binding', async () => {
    const queue = new DetailExtensionSendQueue()
    let finish!: (value: unknown) => void
    mocks.call.mockImplementation(() => new Promise(resolve => { finish = resolve }))
    const task = queue.enqueue({ ...input, role: { userId: 11, roleId: 'role' } }); await flush()
    arkmeAuthStore.setAuth({ status: 'authenticated', environment: 'test', userId: 12 })
    finish({ roleId: 'role', name: '理性我' }); await flush()
    expect(task.state).toBe('failed')
    expect(mocks.call.mock.calls.map(([operation]) => operation)).toEqual(['self-roles.bind'])
    expect(queue.views('test:12', 'self')).toEqual([])
    queue.retry(task); await flush()
    expect(mocks.call).toHaveBeenCalledTimes(1)
  })
  it('restores interrupted sends as uncertain without automatically writing again', async () => {
    const storage = journal(), queue = new DetailExtensionSendQueue(storage)
    mocks.call.mockImplementation(() => new Promise(() => {}))
    queue.enqueue(input); await flush()
    const restored = new DetailExtensionSendQueue(storage)
    expect(restored.views('test:11', 'self')[0]).toMatchObject({ state: 'uncertain', textContent: '延展', recordUid: 'record' })
    expect(mocks.call).toHaveBeenCalledTimes(1)
    queue.clear()
  })
  it('preserves nested source, rich media, role and mentions in the pending projection', () => {
    const task = { ...input, state: 'sending' as const, parent: { ...input.parent, itemUid: 'nested-parent' }, extension: { ...input.extension,
      selfRole: { roleId: 'role', name: '理性我' }, mentions: [{ kind: 'all' as const, startIndex: 0, length: 3, displayName: '所有人' }],
      contentBlocks: [{ kind: 'file' as const, mediaRef: 'local', fileName: '附件.pdf', sortOrder: 0 }] } }
    expect(detailExtensionSendTimelineItem(task)).toMatchObject({ extensionParentRecordUid: 'nested-parent', selfRole: { roleId: 'role' },
      contentBlocks: [{ fileName: '附件.pdf' }], mentions: [{ kind: 'all' }] })
  })
})
