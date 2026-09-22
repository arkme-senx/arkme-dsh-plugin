// @vitest-environment jsdom
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { TeamConversation } from '../src/team-app-contract.js'
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
