// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { useTeamVisitorActions } from '../src/client/TeamVisitorActions.js'
import { TeamVisitorRecords } from '../src/client/TeamVisitorRecords.js'
import { arkmeUi } from '../src/client/ui-controller.js'
import type { TeamConversation, TeamMessage } from '../src/team-app-contract.js'
const { call } = vi.hoisted(() => ({ call: vi.fn() }))
vi.mock('../src/client/api.js', () => ({ callArkme: call }))
const conversation = { ref: 'conversation-ref', key: 'conversation-key', side: 'team', visitor: { nickname: '访客' } } as TeamConversation
const message = (seq: number, side: 'team' | 'external' = 'external'): TeamMessage => ({ key: `m${seq}`, ref: `ref${seq}`, seq, revision: 1, side,
  own: false, sender: { nickname: side === 'team' ? '同事' : '访客' }, state: 'published', createdAt: Date.now(), canEdit: false, canDelete: false,
  version: 1, contentStatus: 'available', media: [], content: { template_kind: 1, text_content: `正文 ${seq}` } })
let host: HTMLDivElement, root: Root
const onRecords = vi.fn(), onOpen = vi.fn(), onClose = vi.fn(), onLocate = vi.fn()
function Harness({ value = conversation }: { value?: TeamConversation }) {
  const actions = useTeamVisitorActions({ conversation: value, accountKey: 'prod:90', onRecords, onOpen })
  return <>{actions.avatar(<span>头像</span>)}{actions.layer}</>
}
const tick = async () => { await Promise.resolve(); await Promise.resolve() }
const findButton = (name: string) => [...document.querySelectorAll('button')].find(node => node.textContent === name)!
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal('IntersectionObserver', class { observe() {} disconnect() {} })
  vi.clearAllMocks(); call.mockReset(); onLocate.mockResolvedValue(undefined)
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
})
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

it('shows the shared user card; only explicit Send opens the verified private conversation', async () => {
  const activate = vi.spyOn(arkmeUi, 'activateNotificationSource').mockImplementation(() => {})
  const source = { sourceRef: 'private-source', kind: 'private_chat' }
  call.mockResolvedValue({ source })
  await act(async () => root.render(<Harness />))
  await act(async () => host.querySelector('button')!.click())
  expect(host.querySelector('[role="dialog"]')?.getAttribute('aria-label')).toBe('访客 的用户卡片')
  expect(call).not.toHaveBeenCalled()
  await act(async () => { findButton('发送消息').click(); await tick() })
  expect(call).toHaveBeenCalledExactlyOnceWith('team.app.visitor.private.open', { conversationRef: 'conversation-ref', expectedAccountKey: 'prod:90' }, expect.any(AbortSignal))
  expect(activate).toHaveBeenCalledWith(source)
  expect(host.querySelector('[role="dialog"]')).toBeNull()
})

it('closes on the scrim and Escape, and cancels a pending open without late navigation', async () => {
  const activate = vi.spyOn(arkmeUi, 'activateNotificationSource').mockImplementation(() => {})
  let resolve!: (result: unknown) => void
  call.mockImplementation(() => new Promise(done => { resolve = done }))
  await act(async () => root.render(<Harness />))
  await act(async () => host.querySelector('button')!.click())
  await act(async () => host.querySelector('[role="presentation"]')!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })))
  expect(host.querySelector('[role="dialog"]')).toBeNull()
  await act(async () => host.querySelector('button')!.click())
  await act(async () => findButton('发送消息').click())
  expect(findButton('正在打开…').disabled).toBe(true)
  await act(async () => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })))
  expect(call.mock.calls[0]![2].aborted).toBe(true)
  await act(async () => { resolve({ source: {} }); await tick() })
  expect(activate).not.toHaveBeenCalled()
})

it('keeps failures in the card and supports retry; right-click opens only this visitor records', async () => {
  call.mockRejectedValue(new Error('账号暂不可用'))
  await act(async () => root.render(<Harness />))
  await act(async () => host.querySelector('button')!.click())
  await act(async () => { findButton('发送消息').click(); await tick() })
  expect(host.querySelector('[role="alert"]')?.textContent).toBe('账号暂不可用')
  expect(findButton('发送消息').disabled).toBe(false)
  await act(async () => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })))
  await act(async () => host.querySelector('button')!.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 20, clientY: 20 })))
  const menu = document.querySelector('[role="menu"]')!
  expect(menu.textContent).toContain('看TA的快记')
  await act(async () => menu.querySelector<HTMLElement>('[role="menuitem"]')!.click())
  expect(onRecords).toHaveBeenCalledOnce()
})

it('never exposes visitor actions to the external viewer', async () => {
  await act(async () => root.render(<Harness value={{ ...conversation, side: 'external' }} />))
  expect(host.querySelector('button')).toBeNull()
})

it('paginates external records only, deduplicates them, and locates the chosen source', async () => {
  call.mockImplementation(async (_op, payload) => ({ conversation,
    messages: payload.beforeSeq ? [message(7), message(8), message(6, 'team')] : [message(10, 'team'), message(9), message(8)],
    hasMore: !payload.beforeSeq, beforeSeq: payload.beforeSeq ? 6 : 8 }))
  await act(async () => { root.render(<TeamVisitorRecords conversation={conversation} accountKey="prod:90" onClose={onClose} onLocate={onLocate} />); await tick() })
  expect([...host.querySelectorAll('[data-team-visitor-record]')].map(n => n.getAttribute('data-team-visitor-record'))).toEqual(['m9', 'm8'])
  await act(async () => { findButton('加载更早消息').click(); await tick() })
  expect([...host.querySelectorAll('[data-team-visitor-record]')].map(n => n.getAttribute('data-team-visitor-record'))).toEqual(['m9', 'm8', 'm7'])
  expect(call.mock.calls[1]![1]).toMatchObject({ beforeSeq: 8, expectedAccountKey: 'prod:90' })
  await act(async () => { host.querySelector<HTMLButtonElement>('[data-team-visitor-record="m7"] button')!.click(); await tick() })
  expect(onLocate).toHaveBeenCalledWith(expect.objectContaining({ key: 'm7' }), expect.any(AbortSignal))
  expect(onClose).toHaveBeenCalledOnce()
})

it('skips team-only pages without falsely reporting empty results, hides deleted content', async () => {
  call.mockImplementation(async (_op, payload) => ({ conversation,
    messages: payload.beforeSeq ? [message(2), { ...message(1), contentStatus: 'deleted' }] : [message(4, 'team')],
    hasMore: !payload.beforeSeq, beforeSeq: payload.beforeSeq ? 1 : 4 }))
  await act(async () => { root.render(<TeamVisitorRecords conversation={conversation} accountKey="prod:90" onClose={onClose} onLocate={onLocate} />); await tick() })
  expect(call).toHaveBeenCalledTimes(2)
  expect(host.querySelectorAll('[data-team-visitor-record]')).toHaveLength(1)
  expect(host.textContent).not.toContain('暂无快记')
})

it('keeps loaded records on network error and retries the same page, clears them on lost access', async () => {
  let failed = true
  call.mockImplementation(async (_op, payload) => {
    if (payload.beforeSeq && failed) throw new Error('网络失败')
    return { conversation, messages: [message(5)], hasMore: true, beforeSeq: 5 }
  })
  await act(async () => { root.render(<TeamVisitorRecords conversation={conversation} accountKey="prod:90" onClose={onClose} onLocate={onLocate} />); await tick() })
  await act(async () => { findButton('加载更早消息').click(); await tick() })
  expect(host.querySelectorAll('[data-team-visitor-record]')).toHaveLength(1)
  expect(host.querySelector('[role="alert"]')?.textContent).toContain('网络失败')
  call.mockRejectedValue({ body: { code: 'team-not_accessible' } })
  await act(async () => { findButton('重试').click(); await tick() })
  expect(call.mock.calls.at(-1)![1].beforeSeq).toBe(5)
  expect(host.querySelectorAll('[data-team-visitor-record]')).toHaveLength(0)
})
