import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { expect, it, vi } from 'vitest'
const api = vi.hoisted(() => ({ call: vi.fn() }))
vi.mock('../src/client/api.js', async original => ({ ...await original<typeof import('../src/client/api.js')>(), callArkme: api.call }))
import { ArkmeClientError } from '../src/client/api.js'
vi.mock('react-dom', () => ({ createPortal: (node: unknown) => node }))
import { ArkmeMemberRecordsPanel } from '../src/client/ArkmeChatMemberActions.js'
import type { ArkmeConversationMemberRecordMode } from '../src/types.js'
import { ArkmeMediaPreview } from '../src/client/ArkmeRichContent.js'

it('keeps member history and its preview on reference rotation, but reloads a different query', async () => {
  vi.stubGlobal('window', { addEventListener: vi.fn(), removeEventListener: vi.fn(), requestAnimationFrame: () => 1, cancelAnimationFrame: vi.fn() })
  vi.stubGlobal('document', { body: { style: {} } })
  const item = { itemUid: 'image', senderName: '成员', isMe: false, sendAtMillis: 1, title: '', textContent: '', status: 1,
    contentBlocks: [{ kind: 'image', mediaRef: 'image-ref', fileAssetUid: 'asset', fileName: 'photo.png', mimeType: 'image/png', size: 1, sortOrder: 0 }] }
  api.call.mockResolvedValue({ items: [item], hasMore: false })
  let view: ReactTestRenderer | undefined
  const render = (sourceRef: string, sourceIdentityKey = 'chat-a', memberRef = 'member-a', mode: ArkmeConversationMemberRecordMode = 'owner') => <ArkmeMemberRecordsPanel
    sourceRef={sourceRef} sourceIdentityKey={sourceIdentityKey} member={{ memberRef, displayName: '成员', role: 'member', status: 'active', isSelf: false, isOwner: false, joinedAtMillis: 1, recordCount: 1, mentionCount: 0 }}
    mode={mode} onClose={() => {}} />
  try {
    await act(async () => { view = create(render('old')) })
    await act(async () => view!.root.findByProps({ 'aria-label': '预览图片 photo.png' }).props.onClick())
    expect(view!.root.findAllByType(ArkmeMediaPreview)).toHaveLength(1)
    const reads = api.call.mock.calls.length
    await act(async () => view!.update(render('new')))
    expect(api.call).toHaveBeenCalledTimes(reads + 1)
    expect(view!.root.findAllByType(ArkmeMediaPreview)).toHaveLength(1)
    await act(async () => view!.update(render('new', 'chat-a', 'member-b')))
    expect(api.call).toHaveBeenLastCalledWith('source.member-records', expect.objectContaining({ sourceRef: 'new', memberRef: 'member-b' }), expect.any(AbortSignal))
    expect(view!.root.findAllByType(ArkmeMediaPreview)).toHaveLength(0)
    await act(async () => view!.root.findByProps({ 'aria-label': '预览图片 photo.png' }).props.onClick())
    await act(async () => view!.update(render('other', 'chat-b', 'member-b')))
    expect(view!.root.findAllByType(ArkmeMediaPreview)).toHaveLength(0)
    await act(async () => view!.root.findByProps({ 'aria-label': '预览图片 photo.png' }).props.onClick())
    await act(async () => view!.update(render('other-new', 'chat-b', 'member-b', 'mentioned')))
    expect(api.call).toHaveBeenLastCalledWith('source.member-records', expect.objectContaining({ sourceRef: 'other-new', mode: 'mentioned' }), expect.any(AbortSignal))
    expect(view!.root.findAllByType(ArkmeMediaPreview)).toHaveLength(0)
    await act(async () => view!.root.findByProps({ 'aria-label': '预览图片 photo.png' }).props.onClick())
    api.call.mockRejectedValue(new ArkmeClientError({ code: 'chat-member-ref-stale', message: '该成员已不属于当前会话', retryable: false }))
    await act(async () => view!.update(render('revoked', 'chat-b', 'member-b', 'mentioned')))
    expect(view!.root.findAllByType(ArkmeMediaPreview)).toHaveLength(0)
    expect(JSON.stringify(view!.toJSON())).toContain('该成员已不属于当前会话')
  } finally {
    if (view) await act(async () => view!.unmount())
    vi.unstubAllGlobals()
  }
})

it('refreshes the loaded range atomically, retries a failed refresh and retains the older-page cursor', async () => {
  vi.stubGlobal('window', { addEventListener: vi.fn(), removeEventListener: vi.fn(), requestAnimationFrame: () => 1, cancelAnimationFrame: vi.fn() })
  vi.stubGlobal('document', { body: { style: {} } })
  const record = (sequence: number, image = false) => ({ itemUid: `r-${sequence}`, sequence, senderName: '成员', isMe: false,
    sendAtMillis: sequence, title: '', textContent: `message-${sequence}`, status: 1,
    contentBlocks: image ? [{ kind: 'image', mediaRef: 'image-ref', fileAssetUid: 'asset', fileName: 'history.png', mimeType: 'image/png', size: 1, sortOrder: 0 }] : [] })
  let failRefresh = true
  let deleted = false
  const reads: Array<[string, number | undefined]> = []
  api.call.mockImplementation(async (_operation, params) => {
    reads.push([params.sourceRef, params.beforeSequence])
    if (deleted) return { items: [record(50)], hasMore: false }
    if (params.sourceRef === 'old') return params.beforeSequence === undefined
      ? { items: [record(30), record(20, true)], hasMore: true, nextCursor: { beforeSequence: 20 } }
      : { items: [record(10)], hasMore: true, nextCursor: { beforeSequence: 10 } }
    if (params.beforeSequence === undefined) return { items: [record(50)], hasMore: true, nextCursor: { beforeSequence: 40 } }
    if (params.beforeSequence === 40) {
      if (failRefresh) throw new Error('refresh failed')
      return { items: [record(30), record(20, true)], hasMore: true, nextCursor: { beforeSequence: 20 } }
    }
    if (params.beforeSequence === 20) return { items: [record(10)], hasMore: true, nextCursor: { beforeSequence: 10 } }
    return { items: [record(5)], hasMore: false }
  })
  const render = (sourceRef: string) => <ArkmeMemberRecordsPanel sourceRef={sourceRef} sourceIdentityKey="chat"
    member={{ memberRef: 'm', displayName: '成员', role: 'member', status: 'active', isSelf: false, isOwner: false, joinedAtMillis: 1, recordCount: 5, mentionCount: 0 }}
    mode="owner" onClose={() => {}} />
  let view: ReactTestRenderer | undefined
  const older = async () => { await act(async () => view!.root.findAllByType('div').find(node => node.props.onScroll)?.props.onScroll({ currentTarget: { scrollTop: 0 } })) }
  try {
    await act(async () => { view = create(render('old')) })
    await older()
    await act(async () => view!.root.findByProps({ 'aria-label': '预览图片 history.png' }).props.onClick())
    await act(async () => view!.update(render('new')))
    expect(view!.root.findAllByType(ArkmeMediaPreview)).toHaveLength(1)
    expect(JSON.stringify(view!.toJSON())).toContain('message-10')
    expect(JSON.stringify(view!.toJSON())).not.toContain('message-50')
    failRefresh = false
    await act(async () => view!.root.findByProps({ role: 'alert' }).findByType('button').props.onClick())
    expect(reads.slice(-3)).toEqual([['new', undefined], ['new', 40], ['new', 20]])
    expect(JSON.stringify(view!.toJSON())).toContain('message-50')
    expect(JSON.stringify(view!.toJSON())).toContain('message-10')
    expect(view!.root.findAllByType(ArkmeMediaPreview)).toHaveLength(1)
    await older()
    expect(reads.at(-1)).toEqual(['new', 10])
    deleted = true
    await act(async () => view!.update(render('removed')))
    expect(view!.root.findAllByType(ArkmeMediaPreview)).toHaveLength(0)
    expect(JSON.stringify(view!.toJSON())).not.toContain('message-20')
  } finally {
    if (view) await act(async () => view!.unmount())
    vi.unstubAllGlobals()
  }
})

it.each(['append', 'prepend', 'delete-before', 'scroll-during-load'])('preserves the visible record during %s', async scenario => {
  vi.stubGlobal('window', { addEventListener: vi.fn(), removeEventListener: vi.fn(), requestAnimationFrame: () => 1, cancelAnimationFrame: vi.fn() })
  vi.stubGlobal('document', { body: { style: {} } })
  let view: ReactTestRenderer | undefined
  const committed = () => view !== undefined && JSON.stringify(view.toJSON()).includes("replacement-committed")
  const offset = () => 400 + (committed() ? scenario === 'prepend' ? 100 : scenario === 'delete-before' ? -100 : 0 : 0)
  let finish: ((value: unknown) => void) | undefined
  const body = { scrollTop: 0, get scrollHeight() { return 1000 + (committed() ? scenario === 'delete-before' ? -100 : 100 : 0) }, clientHeight: 600,
    getBoundingClientRect: () => ({ top: 0, bottom: 600 }),
    querySelectorAll: () => [{ dataset: { arkmeMemberRecordId: 'visible' }, getBoundingClientRect: () => ({ top: offset() - body.scrollTop, bottom: offset() - body.scrollTop + 50 }) }] }
  const item = { itemUid: 'visible', senderName: '成员', isMe: false, sendAtMillis: 1, title: '', textContent: 'visible', status: 1 }
  api.call.mockResolvedValueOnce({ items: [item], hasMore: scenario === 'prepend', nextCursor: { beforeSequence: 10 } })
    .mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
  const render = (sourceRef: string) => <ArkmeMemberRecordsPanel sourceRef={sourceRef} sourceIdentityKey="chat"
    member={{ memberRef: 'm', displayName: '成员', role: 'member', status: 'active', isSelf: false, isOwner: false, joinedAtMillis: 1, recordCount: 4, mentionCount: 0 }} mode="owner" onClose={() => {}} />
  try {
    await act(async () => { view = create(render('old'), { createNodeMock: element => element.type === 'div' && element.props.onScroll ? body : null }) })
    expect(body.scrollTop).toBe(1000)
    body.scrollTop = 200
    if (scenario === 'prepend') {
      await act(async () => view!.root.findAllByType('div').find(node => node.props.onScroll)!.props.onScroll({ currentTarget: { scrollTop: 0 } }))
    } else await act(async () => view!.update(render('new')))
    if (scenario === 'scroll-during-load') body.scrollTop = 250
    const expected = body.scrollTop + (scenario === 'prepend' ? 100 : scenario === 'delete-before' ? -100 : 0)
    await act(async () => finish!({ items: [{ ...item, textContent: 'replacement-committed' }], hasMore: false }))
    expect(body.scrollTop).toBe(expected)
  } finally {
    if (view) await act(async () => view!.unmount())
    vi.unstubAllGlobals()
  }
})

it('ignores late responses after consecutive reference rotations and a query switch', async () => {
  vi.stubGlobal('window', { addEventListener: vi.fn(), removeEventListener: vi.fn(), requestAnimationFrame: () => 1, cancelAnimationFrame: vi.fn() })
  vi.stubGlobal('document', { body: { style: {} } })
  const pending: Array<{ resolve: (value: unknown) => void; signal: AbortSignal }> = []
  api.call.mockImplementation((_operation, _params, signal) => new Promise(resolve => pending.push({ resolve, signal })))
  const render = (sourceRef: string, sourceIdentityKey = 'chat-a') => <ArkmeMemberRecordsPanel sourceRef={sourceRef} sourceIdentityKey={sourceIdentityKey}
    member={{ memberRef: 'm', displayName: '成员', role: 'member', status: 'active', isSelf: false, isOwner: false, joinedAtMillis: 1, recordCount: 4, mentionCount: 0 }} mode="owner" onClose={() => {}} />
  const page = (textContent: string) => ({ items: [{ itemUid: textContent, senderName: '成员', isMe: false, sendAtMillis: 1, title: '', textContent, status: 1 }], hasMore: false })
  let view: ReactTestRenderer | undefined
  try {
    await act(async () => { view = create(render('one')) })
    await act(async () => view!.update(render('two')))
    await act(async () => view!.update(render('three')))
    await act(async () => view!.update(render('other', 'chat-b')))
    expect(pending.slice(0, 3).every(request => request.signal.aborted)).toBe(true)
    await act(async () => pending[3]!.resolve(page('current-result')))
    await act(async () => { for (const request of pending.slice(0, 3)) request.resolve(page('stale-result')) })
    expect(JSON.stringify(view!.toJSON())).toContain('current-result')
    expect(JSON.stringify(view!.toJSON())).not.toContain('stale-result')
  } finally {
    if (view) await act(async () => view!.unmount())
    vi.unstubAllGlobals()
  }
})
