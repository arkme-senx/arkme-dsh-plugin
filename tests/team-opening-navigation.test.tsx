// @vitest-environment jsdom
import { act, useSyncExternalStore } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { TeamConversation, TeamMessage, TeamOpen } from '../src/team-app-contract.js'
import { TeamMessagingMount, TeamMessagingPanel } from '../src/client/TeamMessagingPanel.js'
import { openTeamMessages } from '../src/client/team-messaging-events.js'
import { arkmeUi } from '../src/client/ui-controller.js'

const mocks = vi.hoisted(() => ({ call: vi.fn() }))
vi.mock('../src/client/api.js', () => ({ callArkme: mocks.call }))
let root: Root, host: HTMLDivElement
const tick = async () => { await Promise.resolve(); await Promise.resolve() }
function Workspace() {
  const state = useSyncExternalStore(arkmeUi.subscribe, arkmeUi.getSnapshot)
  return <><TeamMessagingMount accountKey="navigation-test" active />
    {state.mode === 'team' && state.teamIntent && <TeamMessagingPanel accountKey="navigation-test" intent={state.teamIntent} />}</>
}
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal('IntersectionObserver', class { observe() {} disconnect() {} })
  mocks.call.mockReset(); arkmeUi.authChanged(true, true); arkmeUi.showHarness()
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
})
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals() })

it.each(['success', 'failure'])('leaving Team for a normal conversation cancels late opening %s', async outcome => {
  let resolve!: (value: TeamOpen) => void, reject!: (error: Error) => void
  const pending = new Promise<TeamOpen>((ok, no) => { resolve = ok; reject = no })
  mocks.call.mockImplementation(async (op: string) => {
    if (op === 'team.app.attention') return {team:false, external:false, applications:false}
    if (op === 'team.app.conversations') return {items:[], hasMore:false}
    if (op === 'team.app.open') return pending
    throw new Error(op)
  })
  await act(async () => { root.render(<Workspace />); await tick() })
  await act(async () => { openTeamMessages({kind:'link', publicRef:'a'.repeat(32)}); await tick() })
  expect(document.querySelector('[role="dialog"]')).toBeNull()
  await act(async () => { arkmeUi.focusSendToSelf(); await tick() })
  await act(async () => {
    if(outcome === 'failure') reject(new Error('old opening failed'))
    else resolve({channel:{teamRef:'old-team', name:'旧入口', jotmoId:'old_team', publicRef:'a'.repeat(32),link:'',enabled:true,revision:1,canManage:false},openInbox:true})
    await tick()
  })
  expect(arkmeUi.getSnapshot().mode).toBe('source')
  expect(document.body.textContent).not.toContain('old opening failed')
  expect(mocks.call.mock.calls.some(([op]) => op === 'team.app.timeline')).toBe(false)
})

it('official setup failure has a local retry and no unrelated membership UI', async () => {
  mocks.call.mockImplementation(async (op: string) => {
    if (op === 'team.app.official') throw new Error('暂时无法联系作者，请稍后重试')
    if (op === 'team.app.conversations') return { items: [], hasMore: false }
    return { team: false, external: false, applications: false }
  })
  await act(async () => { root.render(<Workspace />); openTeamMessages({kind:'official'}); await tick() })
  expect(host.textContent).toContain('联系作者')
  expect(host.textContent).toContain('暂时无法联系作者')
  expect(host.querySelector('[role="dialog"]')).toBeNull()
  expect(host.textContent).not.toMatch(/无权访问|创建团队|加入团队|收件箱/)
  await act(async () => { (host.querySelector('button') as HTMLButtonElement).click(); await tick() })
  expect(mocks.call.mock.calls.filter(([op]) => op === 'team.app.official')).toHaveLength(2)
})

it('returns to the same team after replying, switches visitors and keeps each draft', async () => {
  const channel = { teamRef: 'studio', name: '设计工作室', jotmoId: 'studio', publicRef: 'a'.repeat(32), link: '', enabled: true, revision: 1, canManage: true }
  const first: TeamConversation = { key: 'visitor-a', ref: 'visitor-a', side: 'team', channel, visitor: { nickname: '来访者甲' }, lastSeq: 0, latestTeamReplySeq: 0, myReadSeq: 0, unread: 1, needsReply: true, blocked: false, revision: 1, updatedAt: Date.now() }
  const second = { ...first, key: 'visitor-b', ref: 'visitor-b', visitor: { nickname: '来访者乙' }, unread: 0 }
  const elsewhere = { ...first, key: 'other-team', ref: 'other-team', channel: { ...channel, teamRef: 'another-studio', jotmoId: 'another_studio', name: '其他团队' }, visitor: { nickname: '其他团队来访者' } }
  const messages: TeamMessage[] = []
  mocks.call.mockImplementation(async (op: string, params: { side?: string; conversationRef?: string; content?: { text_content: string } }) => {
    if (op === 'team.app.attention') return {team: false, external: false, applications: false}
    if (op === 'team.app.channel') return {...channel, teamRef:'fresh-encrypted-channel-reference'}
    if (op === 'team.app.conversations') return {items: params.side === 'team' ? [first, second, elsewhere] : [], hasMore: false}
    if (op === 'team.app.timeline') return {conversation: params.conversationRef === first.ref ? first : second, messages: params.conversationRef === first.ref ? messages : [], hasMore: false, beforeSeq: 0}
    if (op === 'team.app.send') {
      const message: TeamMessage = {key:'sent', ref:'sent', seq:1, revision:1, side:'team', sender:{nickname:'我'}, own:true, state:'published', createdAt:Date.now(), canEdit:true, canDelete:true, media:[], version:1, contentStatus:'available', content:params.content!}
      messages.push(message)
      first.preview = {status:'available', text: params.content!.text_content, hasMedia:false}
      return {message}
    }
    if (op === 'team.app.read') return {}
    throw new Error(op)
  })
  const click = async (label: string) => {
    const target = [...host.querySelectorAll<HTMLButtonElement>('button')].find(node => node.getAttribute('aria-label') === label || node.textContent?.includes(label))
    expect(target, label).toBeDefined()
    await act(async () => { target!.click(); await tick() })
  }
  const type = async (value: string) => {
    await act(async () => {
      const editor = host.querySelector<HTMLElement>('[contenteditable="true"]')!
      editor.textContent = value
      editor.dispatchEvent(new InputEvent('input', {bubbles:true, inputType:'insertText', data:value}))
      await tick()
    })
  }
  await act(async () => { root.render(<Workspace />); openTeamMessages({kind:'team', teamRef:channel.teamRef}); await tick() })
  expect(host.querySelectorAll('.team-conversation-row')).toHaveLength(2)
  expect(host.textContent).not.toContain('其他团队来访者')
  await click('来访者甲')
  await type('回复甲')
  await click('发送')
  expect(messages[0]?.content?.text_content).toBe('回复甲')
  await type('甲的未发草稿')
  await click('返回团队对话')
  expect(arkmeUi.getSnapshot().teamIntent).toEqual({kind:'team', teamRef:'studio'})
  expect(host.querySelectorAll('.team-conversation-row')).toHaveLength(2)
  expect(host.textContent).toContain('回复甲')
  await click('来访者乙')
  expect(host.querySelector('[contenteditable="true"]')?.textContent).toBe('')
  await type('乙的未发草稿')
  await click('返回团队对话')
  await click('来访者甲')
  expect(host.querySelector('[contenteditable="true"]')?.textContent).toBe('甲的未发草稿')
  expect(mocks.call.mock.calls.some(([op]) => op === 'team.app.block')).toBe(false)
})
