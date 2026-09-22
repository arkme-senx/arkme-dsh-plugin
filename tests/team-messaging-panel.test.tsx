// @vitest-environment jsdom
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { TeamConversation, TeamMessage } from '../src/team-app-contract.js'
import { hasUnreadTeamMessages } from '../src/client/team-message-unread.js'

const mocks = vi.hoisted(() => ({ call: vi.fn() }))
vi.mock('../src/client/api.js', () => ({ callArkme: mocks.call }))
vi.mock('../src/sdk/index.js', () => ({ createArkmeSdk: () => ({ upload: vi.fn() }) }))
import { TeamConversationPane } from '../src/client/TeamMessagingPanel.js'

const conversation: TeamConversation = { ref: 'conv', key: 'key', channel: { teamRef: 'team', name: '团队', jotmoId: 'arkme_cn', publicRef: 'a'.repeat(32), link: '', enabled: true, revision: 1, canManage: false }, side: 'external', lastSeq: 0, latestTeamReplySeq: 0, myReadSeq: 0, unread: 0, needsReply: false, blocked: false, revision: 1, updatedAt: 1 }
const storageKey = 'arkme.team.draft:account:key'
let renderer: ReactTestRenderer | undefined
const tick = async () => { await Promise.resolve(); await Promise.resolve() }

describe('Team send UI recovery', () => {
  beforeEach(() => {
    localStorage.clear(); mocks.call.mockReset()
    vi.stubGlobal('IntersectionObserver', class { observe() {} disconnect() {} })
    vi.stubGlobal('requestAnimationFrame', (callback: () => void) => { callback(); return 1 })
    localStorage.setItem(storageKey, JSON.stringify({ text: '问题', assets: [] }))
    mocks.call.mockImplementation(async (op: string) => {
      if (op === 'team.app.timeline') return { conversation, messages: [], hasMore: false, beforeSeq: 0 }
      throw new Error('network lost')
    })
  })
  afterEach(async () => { await act(async () => renderer?.unmount()); renderer = undefined; vi.restoreAllMocks(); vi.unstubAllGlobals() })
  const mount = async () => { await act(async () => { renderer = create(<TeamConversationPane conversation={conversation} accountKey="account" onChanged={() => {}} />); await tick() }) }
  const send = async () => { await act(async () => { renderer!.root.findByType('form').props.onSubmit({ preventDefault() {} }); await tick() }) }

  it('persists the stable request before network I/O, refuses double admission, and reuses it after remount', async () => {
    let release!: (value: unknown) => void
    mocks.call.mockImplementation(async (op: string, payload: { clientUid?: string }) => {
      if (op === 'team.app.timeline') return { conversation, messages: [], hasMore: false, beforeSeq: 0 }
      if (op === 'team.app.send') {
        expect(JSON.parse(localStorage.getItem(storageKey)!).attempt.uid).toBe(payload.clientUid)
        return await new Promise(resolve => { release = resolve })
      }
      throw new Error(op)
    })
    await mount()
    await act(async () => {
      const submit = renderer!.root.findByType('form').props.onSubmit
      submit({ preventDefault() {} }); submit({ preventDefault() {} }); await tick()
    })
    const first = mocks.call.mock.calls.filter(v => v[0] === 'team.app.send')
    expect(first).toHaveLength(1)
    await act(async () => { renderer?.unmount(); release({ reason: 'dependency_unavailable' }); await tick() })
    await mount(); await send()
    const sends = mocks.call.mock.calls.filter(v => v[0] === 'team.app.send')
    expect(sends[1]?.[1].clientUid).toBe(first[0]?.[1].clientUid)
    await act(async () => { release({ message: { state: 'published' } }); await tick() })
    expect(JSON.parse(localStorage.getItem(storageKey)!).attempt).toBeUndefined()
  })
  it('unlocks a definitive invalid request but retains a cancellable accepted operation', async () => {
    mocks.call.mockImplementation(async (op: string) => {
      if (op === 'team.app.timeline') return { conversation, messages: [], hasMore: false, beforeSeq: 0 }
      throw Object.assign(new Error('请求内容无效'), { body: { code: 'team-invalid_request' } })
    })
    await mount(); await send()
    expect(JSON.parse(localStorage.getItem(storageKey)!).attempt).toBeUndefined()
    mocks.call.mockImplementation(async (op: string) => {
      if (op === 'team.app.timeline') return { conversation, messages: [], hasMore: false, beforeSeq: 0 }
      if (op === 'team.app.send') return { reason: 'invalid_request', message: { ref: 'accepted', state: 'preparing' } }
      return {}
    })
    await send()
    expect(JSON.parse(localStorage.getItem(storageKey)!).attempt.message.ref).toBe('accepted')
    const cancel = renderer!.root.findAllByType('button').find(v => v.children.join('') === '取消本次发送，保留草稿')!
    await act(async () => { cancel.props.onClick(); await tick() })
    expect(mocks.call.mock.calls.find(v => v[0] === 'team.app.withdraw')?.[1]).toEqual({ messageRef: 'accepted' })
    expect(JSON.parse(localStorage.getItem(storageKey)!)).toEqual({ text: '问题', assets: [] })
  })
  it.each(['cancelled', 'withdrawn'])('unlocks a %s send without losing draft or sending a new request', async state => {
    mocks.call.mockImplementation(async (op: string) => op === 'team.app.timeline'
      ? { conversation, messages: [], hasMore: false, beforeSeq: 0 }
      : { message: { state } })
    await mount(); await send()
    expect(JSON.parse(localStorage.getItem(storageKey)!)).toEqual({ text: '问题', assets: [] })
    expect(renderer!.root.findByProps({ 'aria-label': '团队消息内容' }).props.disabled).toBe(false)
    expect(JSON.stringify(renderer!.toJSON())).toContain('草稿已保留')
    expect(mocks.call.mock.calls.filter(v => v[0] === 'team.app.send')).toHaveLength(1)
  })
  it('keeps an edit draft and requires reading the new version before explicit overwrite', async () => {
    let message: TeamMessage = { ref: 'message', key: 'message', seq: 1, revision: 1, side: 'team', sender: { nickname: '成员' }, own: true, state: 'published', createdAt: 1, canEdit: true, canWithdraw: true, content: { text_content: '原内容', template_kind: 1 }, version: 1, contentStatus: 'available', media: [] }
    mocks.call.mockImplementation(async (op: string) => {
      if (op === 'team.app.timeline') return { conversation: { ...conversation, side: 'team' }, messages: [message], hasMore: false, beforeSeq: 0 }
      if (op === 'team.app.edit' && message.version === 1) {
        message = { ...message, version: 2, content: { text_content: '另一位成员的新内容', template_kind: 1 } }
        throw Object.assign(new Error('内容已更新'), { body: { code: 'team-version_conflict' } })
      }
      return {}
    })
    const button = (label: string) => renderer!.root.findAllByType('button').find(v => v.children.join('') === label)!
    const click = async (label: string) => { await act(async () => { button(label).props.onClick(); await tick() }) }
    await mount()
    expect(button('屏蔽此用户')).toBeUndefined()
    await click('编辑')
    await act(async () => { renderer!.root.findByProps({ 'aria-label': '修改消息内容' }).props.onChange({ target: { value: '我的修改' } }) })
    await click('确认修改')
    expect(button('确认修改').props.disabled).toBe(true)
    expect(renderer!.root.findByProps({ 'aria-label': '修改消息内容' }).props.value).toBe('我的修改')
    await click('读取最新版本')
    expect(JSON.stringify(renderer!.toJSON())).toContain('另一位成员的新内容')
    expect(mocks.call.mock.calls.filter(v => v[0] === 'team.app.edit')).toHaveLength(1)
    await click('确认覆盖最新版本')
    const edits = mocks.call.mock.calls.filter(v => v[0] === 'team.app.edit')
    expect(edits.map(v => v[1].version)).toEqual([1, 2])
    expect(edits[1]![1].content.text_content).toBe('我的修改')
    expect(renderer!.root.findAllByProps({ 'aria-label': '修改消息内容' })).toHaveLength(0)
  })
  it('does not send when durable local storage is unavailable', async () => {
    await mount()
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('quota') })
    await send()
    expect(mocks.call.mock.calls.some(v => v[0] === 'team.app.send')).toBe(false)
    expect(JSON.stringify(renderer!.toJSON())).toContain('无法保存发送请求')
  })
})

it('finds unread conversations beyond the first page and cancels stale account scans', async () => {
  const read = vi.fn(async (_side: string, cursor?: string) => cursor ? { items: [{ ...conversation, unread: 1 }], hasMore: false } : { items: [conversation], hasMore: true, nextCursor: 'next' })
  const controller = new AbortController()
  expect(await hasUnreadTeamMessages(read, controller.signal)).toBe(true)
  expect(read).toHaveBeenCalledTimes(2)
  controller.abort()
  await expect(hasUnreadTeamMessages(read, controller.signal)).rejects.toThrow()
  expect(read).toHaveBeenCalledTimes(2)
})
