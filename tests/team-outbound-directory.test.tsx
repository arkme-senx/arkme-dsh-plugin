// @vitest-environment jsdom
import { act, useSyncExternalStore } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { TeamConversation } from '../src/team-app-contract.js'
import { TeamConversationDirectory } from '../src/client/TeamConversationDirectory.js'
import { TeamMessagingPanel } from '../src/client/TeamMessagingPanel.js'
import { TeamContactAction } from '../src/client/TeamContactAction.js'
import { arkmeUi } from '../src/client/ui-controller.js'
import { arkmeAuthStore } from '../src/client/auth-store.js'
import { startTeamDirectory, refreshTeamDirectory } from '../src/client/team-conversation-directory.js'
import { teamContactTeams } from '../src/client/team-contact.js'
import { teamDirectoryPreferences } from '../src/client/team-directory-preferences.js'
import { openedTeamConversations } from '../src/client/team-opened-conversations.js'

const mock = vi.hoisted(() => vi.fn())
vi.mock('../src/client/api.js', () => ({ callArkme: mock }))
const channel = { teamRef: 'team-ref', jotmoId: 'team_a', name: '研发团队', publicRef: '', link: '', enabled: true, revision: 1, canManage: false }
const conversation: TeamConversation = { key: 'new-person', ref: 'new-ref', side: 'team', channel, visitor: { nickname: '群友甲' }, lastSeq: 0, latestTeamReplySeq: 0, myReadSeq: 0, unread: 0, needsReply: false, blocked: false, revision: 1, updatedAt: 100 }
const context = { accountKey: 'test:42', person: { displayName: '群友甲', recipient: { kind: 'chat-member' as const, sourceRef: 'source', memberRef: 'member' } } }
let root: Root, host: HTMLDivElement, stop: (() => void) | undefined
function Workspace() {
  const ui = useSyncExternalStore(arkmeUi.subscribe, arkmeUi.getSnapshot)
  return <><TeamContactAction context={context} />
    {ui.teamDirectory && <TeamConversationDirectory accountKey={context.accountKey} folder={ui.teamDirectory}
      selectedKey={ui.teamIntent?.kind === 'conversation' ? ui.teamIntent.conversation.key : undefined} onBack={() => {}} />}
    {ui.teamIntent && <TeamMessagingPanel accountKey={context.accountKey} intent={ui.teamIntent} />}</>
}
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal('IntersectionObserver', class { observe() {} disconnect() {} })
  arkmeAuthStore.setAuth({ status: 'authenticated', environment: 'test', userId: 42 } as never)
  arkmeUi.authChanged(true, true); arkmeUi.showHarness(); teamContactTeams.reset(); openedTeamConversations.reset()
  vi.spyOn(teamDirectoryPreferences, 'restoreTarget').mockResolvedValue()
  vi.spyOn(teamDirectoryPreferences, 'hydrate').mockResolvedValue()
  vi.spyOn(teamDirectoryPreferences, 'reconcile').mockResolvedValue()
  vi.spyOn(teamDirectoryPreferences, 'missingPins').mockReturnValue([])
  mock.mockImplementation(async (op: string) => {
    if (op === 'team.app.teams') return [{ ...channel, currentUserRole: 'member' }]
    if (op === 'team.app.outbound.open') return { state: 'ready', conversation }
    if (op === 'team.app.timeline') return { conversation, messages: [], hasMore: false, beforeSeq: 0 }
    if (op === 'team.app.conversations') return { items: [], hasMore: false }
    throw new Error(`Unexpected operation: ${op}`)
  })
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
})
afterEach(async () => { await act(async () => { root.unmount(); stop?.() }); stop = undefined; host.remove(); openedTeamConversations.reset(); mock.mockReset(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

it('clicking the group member contact opens the pane and selected second-column row even when the list omits it', async () => {
  await act(async () => { stop = startTeamDirectory(context.accountKey); root.render(<Workspace />) })
  await act(async () => { (host.querySelector('[aria-label="以 研发团队 联系"]') as HTMLButtonElement).click() })
  const row = host.querySelector('[data-team-conversation-key="new-person"]')!
  expect(row.getAttribute('aria-selected')).toBe('true')
  expect(row.textContent).toContain('群友甲')
  expect(row.textContent).toContain('尚未发送消息')
  expect(row.textContent).not.toContain('内容暂不可用')
  expect(host.querySelector('.team-conversation-pane')).not.toBeNull()
  expect(arkmeUi.getSnapshot().teamDirectory?.channel?.jotmoId).toBe(channel.jotmoId)
  await act(async () => { await refreshTeamDirectory(context.accountKey) })
  expect(host.querySelectorAll('[data-team-conversation-key="new-person"]')).toHaveLength(1)
  expect(mock.mock.calls.some(([op]) => op === 'team.app.send.enqueue' || op === 'team.app.publish')).toBe(false)
})

it('scrolls the selected row into view without changing pin order, including after delayed initial scroll restoration', async () => {
  const oldRows = Array.from({ length: 10 }, (_, i) => ({ ...conversation, key: `existing-${i}`, ref: `ref-${i}`, updatedAt: 200 + i, lastSeq: 1 }))
  let release!: (value: unknown) => void
  const initial = new Promise(resolve => { release = resolve })
  mock.mockImplementation(async (op: string) => op === 'team.app.teams' ? [{ ...channel, currentUserRole: 'member' }]
    : op === 'team.app.outbound.open' ? { state: 'ready', conversation }
    : op === 'team.app.timeline' ? { conversation, messages: [], hasMore: false, beforeSeq: 0 } : initial)
  vi.spyOn(arkmeUi, 'readTeamDirectoryScroll').mockReturnValue(400)
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function () {
    const isSelected = this.dataset.teamConversationKey === conversation.key
    const scrollTop = this.closest('[data-arkme-overlay-scroll-viewport]')?.scrollTop ?? 0
    return { top: isSelected ? 900 - scrollTop : 0, bottom: isSelected ? 980 - scrollTop : 300, left: 0, right: 300, width: 300, height: isSelected ? 80 : 300, x: 0, y: 0, toJSON() {} }
  })
  await act(async () => { stop = startTeamDirectory(context.accountKey); root.render(<Workspace />) })
  await act(async () => { (host.querySelector('[aria-label="以 研发团队 联系"]') as HTMLButtonElement).click() })
  await act(async () => release({ items: oldRows, hasMore: false }))
  const viewport = host.querySelector('[data-arkme-overlay-scroll-viewport]') as HTMLElement
  expect(viewport).not.toBeNull()
  expect(viewport.scrollTop).toBeGreaterThanOrEqual(680)
  expect([...host.querySelectorAll('[data-team-conversation-key]')].map(row => row.getAttribute('data-team-conversation-key'))).toEqual([...oldRows].reverse().map(row => row.key).concat(conversation.key))
  expect(host.querySelector('[data-team-conversation-key="new-person"]')?.getAttribute('aria-selected')).toBe('true')
})
