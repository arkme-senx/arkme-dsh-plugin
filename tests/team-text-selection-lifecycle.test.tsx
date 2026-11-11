// @vitest-environment jsdom
import { webcrypto } from 'node:crypto'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it, vi } from 'vitest'
import { arkmeAuthStore } from '../src/client/auth-store.js'
import { registerLocalSnapshotForward, type LocalSnapshotForward } from '../src/client/local-snapshot-forward.js'
import { TeamConversationPane } from '../src/client/TeamMessagingPanel.js'
import type { NativeForwardResult } from '../src/client/native-forward-entry.js'
import type { TeamConversation, TeamMessage } from '../src/team-app-contract.js'

const mocks = vi.hoisted(() => ({ call: vi.fn() }))
vi.mock('../src/client/api.js', async original => ({
  ...await original<typeof import('../src/client/api.js')>(), callArkme: mocks.call,
}))
vi.mock('../src/sdk/index.js', () => ({ createArkmeSdk: () => ({
  fileCapabilities: async () => ({ maxAttachments: 9, maxImageBytes: 1024, maxFileBytes: 2048 }),
  localFileUrl: (ref: string) => '/local/' + ref,
}) }))

const conversation: TeamConversation = {
  ref: 'team-conversation', key: 'team-key', side: 'team', hasGroupSources: true,
  channel: { teamRef: 'team', name: '团队', jotmoId: 'fixture', publicRef: 'a'.repeat(32),
    link: '', enabled: true, revision: 1, canManage: false },
  lastSeq: 2, latestTeamReplySeq: 0, myReadSeq: 2, unread: 0, needsReply: false,
  blocked: false, revision: 1, updatedAt: 1,
}
const messages = [1, 2].map((seq): TeamMessage => ({
  ref: 'message-' + seq, localMarkRef: 'local:' + seq, key: 'message-' + seq, seq,
  side: 'team', sender: { nickname: '团队成员' }, own: false,
  state: 'published', contentStatus: 'available', content: { text_content: '第' + seq + '条选段示例', template_kind: 1 },
  version: 1, revision: 1, createdAt: seq, canEdit: false, canDelete: false, media: [],
}))
const toolbars = () => [...document.querySelectorAll<HTMLElement>('[data-arkme-text-selection-toolbar]')]

it.each([true, false])('cleans up the Team selection toolbar across rerenders and forward completion=%s', async completed => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal('crypto', webcrypto)
  vi.stubGlobal('IntersectionObserver', class { observe() {} disconnect() {} })
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} })
  vi.stubGlobal('requestAnimationFrame', (fn: FrameRequestCallback) => setTimeout(() => fn(performance.now()), 10))
  vi.stubGlobal('cancelAnimationFrame', clearTimeout)
  Range.prototype.getClientRects = () => [new DOMRect(400, 170, 60, 20)] as unknown as DOMRectList
  arkmeAuthStore.setAuth({ status: 'authenticated', environment: 'test', userId: 7777 })
  mocks.call.mockImplementation(async (op: string, params: Record<string, unknown>) => {
    if (op === 'team.app.timeline') return { conversation, messages, hasMore: false, beforeSeq: 0 }
    if (op === 'arrangements.conversation.recognition.get') return { accountScope: params.expectedAccountScope, enabled: true, version: 0, enabledAt: 0, effectiveEnabled: true, blockedReason: '' }
    if (op === 'arrangements.conversation.list') return { items: [], hasMore: false, nextCursor: '' }
    return []
  })
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  const render = () => act(async () => root.render(<TeamConversationPane conversation={conversation} accountKey="test:7777" />))
  async function select(seq: number) {
    const target = host.querySelector('[data-team-message-key="message-' + seq + '"] [data-arkme-quote-prose]')!
    const text = document.createTreeWalker(target, NodeFilter.SHOW_TEXT).nextNode()!
    await act(async () => {
      target.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }))
      const range = document.createRange()
      range.setStart(text, 0)
      range.setEnd(text, 3)
      document.getSelection()!.removeAllRanges()
      document.getSelection()!.addRange(range)
      target.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }))
    })
  }
  let finish!: (result: NativeForwardResult) => void
  const presenter = vi.fn((content: LocalSnapshotForward) =>
    new Promise<NativeForwardResult>(resolve => { finish = resolve }))
  const unregister = registerLocalSnapshotForward(presenter)
  try {
    await render()
    await select(1)
    const first = toolbars()[0]!
    expect(first?.textContent).toContain('团队内部')

    await render()
    await select(2)
    expect(toolbars()).toEqual([first])
    const forward = [...first.querySelectorAll('button')].find(button => button.textContent === '转发')!
    await act(async () => forward.click())
    await act(async () => { await vi.waitFor(() => expect(presenter).toHaveBeenCalledTimes(1)) })
    expect(presenter.mock.calls[0]?.[0].preview.subtitle).toBe('第2条')
    expect(toolbars()).toHaveLength(0)
    expect(document.getSelection()?.isCollapsed).toBe(true)

    await act(async () => finish({ completed }))
    expect(toolbars()).toHaveLength(0)
    await select(1)
    expect(toolbars()).toHaveLength(1)
    await act(async () => root.render(null))
    expect(toolbars()).toHaveLength(0)
  } finally {
    unregister()
    await act(async () => root.unmount())
    toolbars().forEach(toolbar => toolbar.remove())
    host.remove()
    document.getSelection()?.removeAllRanges()
    arkmeAuthStore.setAuth({ status: 'logged-out', environment: 'test' })
    vi.unstubAllGlobals()
  }
})
