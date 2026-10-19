// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { TeamConversation, TeamMessage, TeamTimeline } from '../src/team-app-contract.js'
import { TeamConversationPreview } from '../src/client/TeamConversationPreview.js'
import { TeamConversationPane } from '../src/client/TeamMessagingPanel.js'
import { groupTeamConversations } from '../src/client/team-conversation-directory.js'
import { arkmeVisibleReadIntentAllowed } from '../src/client/read-intent-visibility.js'

const mocks = vi.hoisted(() => ({ call: vi.fn(), open: vi.fn() }))
vi.mock('../src/client/api.js', () => ({ callArkme: mocks.call }))
vi.mock('../src/client/team-messaging-events.js', async original => ({ ...await original<typeof import('../src/client/team-messaging-events.js')>(), openTeamMessages: mocks.open }))
const channel = { teamRef: 'team', name: '测试团队', jotmoId: 'team', publicRef: '', link: '', enabled: true, revision: 1, canManage: false }
const conversation: TeamConversation = { ref: 'conversation', key: 'conversation', channel, visitor: { nickname: '来访者' }, side: 'team', lastSeq: 4, latestTeamReplySeq: 0, myReadSeq: 0, unread: 4, needsReply: true, blocked: false, revision: 1, updatedAt: 10 }
const message: TeamMessage = { key: 'm4', ref: 'm4', seq: 4, revision: 1, side: 'external', sender: { nickname: '来访者' }, own: false, state: 'published', createdAt: 10, canEdit: false, canDelete: false, version: 1, contentStatus: 'available', content: { text_content: '预览正文', template_kind: 1 }, media: [] }
let host: HTMLDivElement, root: Root, opener: HTMLButtonElement
const close = vi.fn(), changed = vi.fn()
const timeline = (messages = [message]): TeamTimeline => ({ conversation, messages, hasMore: false, beforeSeq: 0 })
const preview = () => <TeamConversationPreview accountKey="preview-test" target={{ kind: 'conversation', conversation }} onClose={close} />
const render = async (node = preview()) => { await act(async () => root.render(node)) }
const button = (text: string) => [...document.querySelectorAll<HTMLButtonElement>('button')].find(b => b.textContent === text || b.getAttribute('aria-label') === text)!
const click = async (text: string) => { expect(button(text)).toBeDefined(); await act(async () => button(text).click()) }
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal('IntersectionObserver', class { constructor(private callback: (entries: unknown[]) => void) {} observe() { this.callback([{ isIntersecting: true }]) } disconnect() {} })
  vi.spyOn(document, 'hasFocus').mockReturnValue(true)
  localStorage.clear(); mocks.call.mockReset(); mocks.open.mockReset(); close.mockReset(); changed.mockReset()
  mocks.call.mockImplementation(async op => { if (op === 'team.app.timeline') return timeline(); if (op === 'team.app.read') return {}; throw new Error(op) })
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
  opener = document.createElement('button'); document.body.append(opener); opener.focus()
})
afterEach(async () => { await act(async () => root.unmount()); host.remove(); opener.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

it('loads read-only messages without navigation, acknowledgement or a composer; opening is explicit', async () => {
  await render()
  expect(document.body.textContent).toContain('预览正文')
  expect(document.querySelector('[contenteditable="true"],textarea')).toBeNull()
  expect(mocks.call.mock.calls.map(([op]) => op)).toEqual(['team.app.timeline'])
  expect(mocks.open).not.toHaveBeenCalled()
  expect(arkmeVisibleReadIntentAllowed()).toBe(false)
  await click('打开对话')
  expect(mocks.open).toHaveBeenCalledWith({ kind: 'conversation', conversation })
  expect(close).toHaveBeenCalledOnce()
})

it('folder selection previews a visitor before opening the real conversation', async () => {
  const group = groupTeamConversations([conversation])[0]!
  await render(<TeamConversationPreview accountKey="preview-test" target={{ kind: 'folder', group }} onClose={close} />)
  expect(mocks.call).not.toHaveBeenCalled()
  await act(async () => document.querySelector<HTMLButtonElement>('[aria-label="团队对话预览列表"] button')!.click())
  expect(document.body.textContent).toContain('预览正文')
  expect(mocks.open).not.toHaveBeenCalled()
  expect(document.activeElement).toBe(document.querySelector('[role="dialog"]'))
  await click('返回团队预览')
  expect(document.querySelector('[aria-label="团队对话预览列表"]')).not.toBeNull()
  expect(document.activeElement).toBe(document.querySelector('[role="dialog"]'))
})

it.each(['vip', 'svip', 'free', 'unknown', undefined] as const)('uses fresh visitor membership %s in the preview title without read acknowledgements', async memberType => {
  const old: TeamConversation = { ...conversation, visitor: { nickname: '访客', memberType: 'svip' } }
  const fresh: TeamConversation = { ...old, visitor: { nickname: '访客', ...(memberType ? { memberType } : {}) } }
  mocks.call.mockResolvedValueOnce({ ...timeline(), conversation: fresh })
  await render(<TeamConversationPreview accountKey="preview-test" target={{ kind: 'conversation', conversation: old }} onClose={close} />)
  const badge = document.querySelector('header [data-arkme-membership]')
  if (memberType === 'vip' || memberType === 'svip') {
    expect(badge?.getAttribute('data-arkme-membership')).toBe(memberType)
    expect(badge?.parentElement?.getAttribute('aria-label')).toBe(`${memberType.toUpperCase()} 会员`)
  } else expect(badge).toBeNull()
  expect(mocks.call.mock.calls.map(([op]) => op)).toEqual(['team.app.timeline'])
})

it('shows stars in folder visitor rows without applying a visitor membership to the team itself', async () => {
  const visitor: TeamConversation = { ...conversation, visitor: { nickname: '会员访客', memberType: 'vip' } }
  const group = groupTeamConversations([visitor])[0]!
  await render(<TeamConversationPreview accountKey="preview-test" target={{ kind: 'folder', group }} onClose={close} />)
  expect(document.querySelector('header [data-arkme-membership]')).toBeNull()
  expect(document.querySelector('[aria-label="团队对话预览列表"] [data-arkme-membership="vip"]')).not.toBeNull()
  const external: TeamConversation = { ...visitor, side: 'external' }
  mocks.call.mockResolvedValueOnce({ ...timeline(), conversation: external })
  await render(<TeamConversationPreview accountKey="preview-test" target={{ kind: 'conversation', conversation: external }} onClose={close} />)
  expect(document.querySelector('header [data-arkme-membership]')).toBeNull()
})

it('has a loading state, retries failures, and aborts a pending request on dismissal', async () => {
  let fail!: (error: Error) => void
  mocks.call.mockReturnValueOnce(new Promise((_, reject) => { fail = reject }))
  await render(); expect(document.body.textContent).toContain('正在加载消息…')
  await act(async () => fail(new Error('网络暂不可用')))
  expect(document.body.textContent).toContain('网络暂不可用')
  await click('重试'); expect(document.body.textContent).toContain('预览正文')
  const signal = mocks.call.mock.calls.at(-1)![2] as AbortSignal
  await render(<></>); expect(signal.aborted).toBe(true)
  expect(document.activeElement).toBe(opener)
  expect(arkmeVisibleReadIntentAllowed()).toBe(true)
})

it('appends older messages without duplicating overlap or changing unread state', async () => {
  mocks.call.mockResolvedValueOnce({ ...timeline(), hasMore: true, beforeSeq: 4 })
  await render()
  mocks.call.mockResolvedValueOnce(timeline([{ ...message, key: 'm1', seq: 1, content: { text_content: '更早内容', template_kind: 1 } }, message]))
  await click('加载更早消息')
  expect([...document.querySelectorAll('article')].map(article => article.textContent)).toEqual([expect.stringContaining('更早内容'), expect.stringContaining('预览正文')])
  expect(mocks.call.mock.calls.map(([op]) => op)).toEqual(['team.app.timeline', 'team.app.timeline'])
  expect(mocks.call.mock.calls[1]![1]).toMatchObject({ beforeSeq: 4, expectedAccountKey: 'preview-test' })
})

it('Escape and backdrop close the preview without opening the conversation', async () => {
  await render()
  await act(async () => document.querySelector('[role="dialog"]')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))
  await act(async () => document.querySelector('[data-arkme-team-preview-backdrop]')!.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })))
  expect(close).toHaveBeenCalledTimes(2)
  expect(mocks.open).not.toHaveBeenCalled()
})

it('suspends the underlying team conversation read intent until the preview closes', async () => {
  const pane = <TeamConversationPane accountKey="preview-background" conversation={conversation} onChanged={changed} />
  await render(<>{pane}{preview()}</>)
  expect(mocks.call.mock.calls.some(([op]) => op === 'team.app.read')).toBe(false)
  await render(<>{pane}</>)
  expect(mocks.call.mock.calls.filter(([op]) => op === 'team.app.read')).toHaveLength(1)
})
