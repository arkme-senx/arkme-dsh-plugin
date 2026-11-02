// @vitest-environment jsdom
import { act, useSyncExternalStore } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { TeamConversationRow } from '../src/client/TeamMessagingPanel.js'
import { TeamConversationGroupRow } from '../src/client/TeamConversationDirectory.js'
import { TeamEntryRemovalContext, teamRemovalActions, teamRemovalEvidence, teamRemovalKey } from '../src/client/TeamEntryRemovalFeedback.js'
import { teamDirectoryPreferences, teamEntryHidden, teamEntryPinned, type TeamEntryTarget } from '../src/client/team-directory-preferences.js'
import { useConversationRemovalFeedback } from '../src/client/use-conversation-removal-feedback.js'
import { groupTeamConversations } from '../src/client/team-conversation-directory.js'
import type { TeamConversation } from '../src/team-app-contract.js'
import type { TeamEntryPreferenceSnapshot } from '../src/team-entry-preference-contract.js'
const { call } = vi.hoisted(() => ({ call: vi.fn() }))
vi.mock('../src/client/api.js', () => ({ callArkme: call }))
const conversation: TeamConversation = { entryKey: 'child', key: 'child', ref: 'child-ref', side: 'external',
  channel: { entryKey: 'folder', teamRef: 'folder-ref', name: '团队', jotmoId: 'team', publicRef: '', link: '', enabled: true, revision: 1, canManage: false },
  lastSeq: 4, unread: 4, myReadSeq: 0, latestTeamReplySeq: 0, needsReply: false, blocked: false, revision: 1, updatedAt: 10 }
let account: string, target: TeamEntryTarget, snapshot: TeamEntryPreferenceSnapshot
let sequence = 0, root: Root, host: HTMLDivElement, fail = false
let release: (() => void) | undefined
const page = () => ({ schemaVersion: 1, items: [snapshot], hasMore: false })
function Fixture() {
  const prefs = useSyncExternalStore(teamDirectoryPreferences.subscribe, () => teamDirectoryPreferences.read(account))
  const rows = ['before', ...(!teamEntryHidden(prefs, target) && snapshot.accessible ? [{ target, pinned: teamEntryPinned(prefs,target) }] : []), 'after']
  const feedback = useConversationRemovalFeedback({ rows, rowKey: row => typeof row === 'string' ? row : teamRemovalKey(row.target),
    activity: teamRemovalEvidence(account, [target]), scope: account, enabled: true,
    canRetain: key => key !== teamRemovalKey(target) || teamDirectoryPreferences.removingOrHidden(account, target),
  })
  return <TeamEntryRemovalContext.Provider value={teamRemovalActions(account, feedback, rows, row => typeof row === 'string' ? undefined : row.target, row => typeof row === 'string' ? false : row.pinned)}>
    {feedback.rows.map(row => typeof row === 'string' ? <span key={row}>{row}</span> : row.target.kind === 'conversation'
      ? <TeamConversationRow key="team" accountKey={account} conversation={row.target.conversation} onClick={() => {}} />
      : <TeamConversationGroupRow key="team" accountKey={account} group={row.target.group} onClick={() => {}} />)}
  </TeamEntryRemovalContext.Provider>
}
async function render() { await act(async () => root.render(<Fixture />)) }
async function select(label: string) {
  const row = host.querySelector<HTMLButtonElement>('.team-conversation-row')!
  await act(async () => row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 100, clientY: 100 })))
  expect(document.body.textContent).toContain('预览')
  await act(async () => [...document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find(b => b.textContent === label)!.click())
}
const remove = () => select('移除')
beforeEach(async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal('IntersectionObserver', class { observe() {} disconnect() {} })
  account = `ux-parity:${++sequence}`; fail = false; release = undefined
  target = { kind: 'conversation', conversation }
  snapshot = { key: 'child', target: {kind:'conversation', ref:'child-ref'}, accessible: true, pinned: false, dismissed: false, version: 1, activitySeq: 4 }
  call.mockReset().mockImplementation(async (operation: string, params: { changes?: { action: string }[] }) => {
    if (operation === 'local.directory.preferences.get') return {schemaVersion: 1, builtinPins: {}, notificationPinned: false}
    if (operation === 'team.app.entries.cached' || operation === 'team.app.entries.list' || operation === 'team.app.entries.query') return page()
    if (operation === 'team.app.entries.change') {
      if (fail) throw new Error('保存失败')
      snapshot = {...snapshot, pinned: params.changes?.[0]?.action === 'pin', dismissed: params.changes?.[0]?.action === 'dismiss', version: snapshot.version + 1}
      await new Promise<void>(resolve => { release = resolve })
      return page()
    }
    throw new Error(operation)
  })
  await teamDirectoryPreferences.hydrate(account)
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
})
afterEach(async () => { await act(async () => { release?.(); root.unmount() }); host.remove(); vi.useRealTimers(); vi.unstubAllGlobals() })
it.each(['conversation', 'folder'] as const)('retains %s with the ordinary row feedback and ordering while the persisted response is pending', async kind => {
  if (kind === 'folder') {
    target = {kind:'folder', group: groupTeamConversations([{...conversation, side:'team'}])[0]!}
    snapshot = {...snapshot, key:'folder', target:{kind:'folder',ref:'folder-ref'}}
    await teamDirectoryPreferences.hydrate(account, true)
  }
  await render(); await remove()
  expect(snapshot.dismissed).toBe(true)
  expect(host.querySelector('[data-arkme-removal-phase="pending"]')).not.toBeNull()
  expect(host.firstElementChild?.textContent).toBe('before')
  expect(host.lastElementChild?.textContent).toBe('after')
  await act(async () => { release!() })
  expect(host.querySelector('[data-arkme-removal-phase="accepted"]')?.textContent).toContain('已移除')
  expect(conversation.unread).toBe(4)
  expect(call.mock.calls.some(([op]) => op === 'team.app.read' || op === 'team.app.block')).toBe(false)
})
it('releases retention and leaves the current row actionable after a failed write', async () => {
  fail = true; await render(); await remove()
  expect(host.querySelector('[data-arkme-removal-phase]')).toBeNull()
  expect(host.querySelector('.team-conversation-row')).not.toBeNull()
  expect(host.textContent).not.toContain('保存失败')
  const status = document.querySelector<HTMLElement>('[role="status"]')!
  expect(status.textContent).toBe('保存失败')
  expect(status.style.position).toBe('fixed')
  expect(host.contains(status)).toBe(false)
})
it.each(['activity', 'restore', 'access', 'account'] as const)('cancels an accepted removal on %s and ignores stale timers', async reason => {
  vi.useFakeTimers(); await render(); await remove(); await act(async () => { release!() })
  expect(host.querySelector('[data-arkme-removal-phase="accepted"]')).not.toBeNull()
  if (reason === 'account') { account = `ux-parity:new-${sequence}` }
  else {
    snapshot = {...snapshot, version: snapshot.version + 1, activitySeq: reason === 'activity' ? 5 : 4,
      accessible: reason !== 'access', dismissed: false}
    await act(async () => { await teamDirectoryPreferences.hydrate(account, true) })
  }
  await render()
  expect(host.querySelector('[data-arkme-removal-phase]')).toBeNull()
  await act(async () => { vi.advanceTimersByTime(2000) })
  expect(host.querySelector('[data-arkme-removal-phase]')).toBeNull()
  if (reason === 'activity' || reason === 'restore') expect(host.querySelector('.team-conversation-row')).not.toBeNull()
})
it('holds for 700ms then reuses the ordinary 220ms collapse, without another server write', async () => {
  vi.useFakeTimers(); await render(); await remove(); await act(async () => { release!() })
  await act(async () => { vi.advanceTimersByTime(699) })
  expect(host.querySelector('[data-arkme-removal-phase="accepted"]')).not.toBeNull()
  await act(async () => { vi.advanceTimersByTime(1) })
  expect(host.querySelector('[data-arkme-removal-phase="collapsing"]')).not.toBeNull()
  await act(async () => { vi.advanceTimersByTime(220) })
  expect(host.querySelector('.team-conversation-row')).toBeNull()
  expect(call.mock.calls.filter(([op]) => op === 'team.app.entries.change')).toHaveLength(1)
})

it.each(['conversation', 'folder'] as const)('keeps the pinned %s snapshot and consumes context menus while removal is pending', async kind => {
  if (kind === 'folder') {
    target = {kind:'folder', group: groupTeamConversations([{...conversation, side:'team'}])[0]!}
    snapshot = {...snapshot, key:'folder', target:{kind:'folder',ref:'folder-ref'}}
  }
  snapshot = {...snapshot,pinned:true}
  await teamDirectoryPreferences.hydrate(account,true)
  await render(); await remove()
  const row=host.querySelector<HTMLButtonElement>('.team-conversation-row')!
  expect(row.getAttribute('data-arkme-removal-phase')).toBe('pending')
  expect(snapshot.pinned).toBe(false)
  expect(row.querySelector('[aria-label="已置顶"]')).not.toBeNull()
  expect(row.tabIndex).toBe(-1)
  const event=new MouseEvent('contextmenu',{bubbles:true,cancelable:true})
  await act(async()=>{row.dispatchEvent(event)})
  expect(event.defaultPrevented).toBe(true)
  expect(document.querySelector('[role="menu"]')).toBeNull()
})
it.each(['置顶对话','取消置顶'] as const)('%s uses the ordinary completion feedback and timeout', async label => {
  vi.useFakeTimers()
  snapshot = {...snapshot,pinned:label==='取消置顶'}
  await teamDirectoryPreferences.hydrate(account,true)
  await render(); await select(label); await act(async()=>{release!()})
  const status=document.querySelector<HTMLElement>('[role="status"]')!
  expect(status.textContent).toBe(label==='取消置顶'?'已取消置顶':'已置顶对话')
  expect(status.style.position).toBe('fixed')
  expect(host.contains(status)).toBe(false)
  await act(async()=>{vi.advanceTimersByTime(2200)})
  expect(document.querySelector('[role="status"]')).toBeNull()
})
it('a late pin completion cannot show feedback in a different account', async()=>{
  await render();await select('置顶对话')
  account='another-account';await render()
  await act(async()=>{release!()})
  expect(document.querySelector('[role="status"]')).toBeNull()
})
