// @vitest-environment jsdom
import { act, useSyncExternalStore } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { TeamPublicCardDialog } from '../src/client/TeamPublicCardDialog.js'
import { TeamMessagingPanel } from '../src/client/TeamMessagingPanel.js'
import { arkmeAuthStore } from '../src/client/auth-store.js'
import { arkmeUi } from '../src/client/ui-controller.js'
import { openTeamEntryMessages } from '../src/client/team-entry-navigation.js'
import type { TeamConversation } from '../src/team-app-contract.js'
import type { TeamEntryPreferenceSnapshot } from '../src/team-entry-preference-contract.js'
const { call } = vi.hoisted(() => ({ call: vi.fn() }))
vi.mock('../src/client/api.js', () => ({ callArkme: call }))
let root: Root, host: HTMLDivElement, id = 991100, account: string
const channel = { teamRef: 'folder-ref', name: '原团队', jotmoId: 'original_team', publicRef: 'a'.repeat(32), link: '', enabled: true, revision: 1, canManage: false }
const conversation: TeamConversation = { entryKey: 'child', ref: 'child-ref', key: 'visitor', side: 'team', channel, lastSeq: 4, latestTeamReplySeq: 0, myReadSeq: 0, unread: 4, needsReply: true, blocked: false, revision: 1, updatedAt: 1 }
let rows: Map<string, TeamEntryPreferenceSnapshot>, member: boolean, failOpen: boolean
const page = (items: TeamEntryPreferenceSnapshot[]) => ({ schemaVersion: 1, items, hasMore: false })
function Workspace() {
  const ui = useSyncExternalStore(arkmeUi.subscribe, arkmeUi.getSnapshot)
  return ui.mode === 'team' && ui.teamIntent ? <TeamMessagingPanel accountKey={account} intent={ui.teamIntent} /> : null
}
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal('IntersectionObserver', class { observe() {} disconnect() {} })
  account = `test:${++id}`; member = true; failOpen = false
  arkmeAuthStore.setAuth({ status: 'authenticated', environment: 'test', userId: id })
  arkmeUi.authChanged(true, true); arkmeUi.showHarness()
  rows = new Map(['folder-ref', 'child-ref'].map((ref, i) => [ref, { key: i ? 'child' : 'folder', target: { kind: i ? 'conversation' : 'folder', ref }, accessible: true, pinned: false, dismissed: true, version: 1, activitySeq: i ? 4 : 0 }]))
  call.mockReset().mockImplementation(async (op: string, p: Record<string, any>) => {
    if (op === 'team.app.public-card') return { name: channel.name, jotmoId: channel.jotmoId, contact: { state: 'available', publicRef: channel.publicRef } }
    if (op === 'team.app.official') return channel
    if (op === 'team.app.open') {
      if (failOpen) throw new Error('打开失败，请重试')
      return member ? { channel, openInbox: true } : { channel, openInbox: false, conversation: { ...conversation, side: 'external' } }
    }
    if (op === 'team.app.conversations') return { items: [conversation], hasMore: false }
    if (op === 'team.app.timeline') return { conversation: { ...conversation, side: 'external' }, messages: [], hasMore: false, beforeSeq: 0 }
    if (op === 'team.app.entries.cached' || op === 'team.app.entries.list') return page([...rows.values()])
    if (op === 'team.app.entries.query') return page(p.entries.map((e: any) => rows.get(e.ref)))
    if (op === 'team.app.entries.change') {
      for (const c of p.changes) { const old = rows.get(c.target.ref)!; expect(c.expectedVersion).toBe(old.version); rows.set(c.target.ref, { ...old, dismissed: c.action === 'dismiss', version: old.version + 1 }) }
      return page(p.changes.map((c: any) => rows.get(c.target.ref)!))
    }
    return {}
  })
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
})
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals() })
it.each([true, false])('card contact uses the original opening UI and restores the authorized historical target (member=%s)', async isMember => {
  member = isMember
  await act(async () => root.render(<><TeamPublicCardDialog accountKey={account} jotmoId={channel.jotmoId} onClose={() => {}} /><Workspace /></>))
  expect(call.mock.calls.some(([op]) => op === 'team.app.open' || op === 'team.app.entries.change')).toBe(false)
  await act(async () => [...document.querySelectorAll('button')].find(b => b.textContent === '联系团队')!.click())
  await vi.waitFor(() => expect(rows.get(member ? 'folder-ref' : 'child-ref')?.dismissed).toBe(false))
  expect(call.mock.calls.filter(([op]) => op === 'team.app.open')).toHaveLength(1)
  expect(call.mock.calls.filter(([op]) => op === 'team.app.entries.change')).toHaveLength(1)
  expect(call.mock.calls.find(([op]) => op === 'team.app.entries.change')![1].changes.map((c: any) => c.target.kind)).toEqual([member ? 'folder' : 'conversation'])
  expect(host.textContent).not.toContain('打开失败')
})
it('mounting a link remains read-only; the existing retry button creates the successful explicit intent', async () => {
  failOpen = true
  await act(async () => { root.render(<Workspace />); openTeamEntryMessages({ kind: 'official' }, account) })
  expect(host.textContent).toContain('打开失败')
  expect(call.mock.calls.filter(([op]) => op === 'team.app.entries.change')).toHaveLength(0)
  failOpen = false
  await act(async () => [...host.querySelectorAll('button')].find(b => b.textContent === '重试')!.click())
  await vi.waitFor(() => expect(rows.get('folder-ref')?.dismissed).toBe(false))
  expect(call.mock.calls.filter(([op]) => op === 'team.app.open')).toHaveLength(2)
  expect(call.mock.calls.filter(([op]) => op === 'team.app.entries.change')).toHaveLength(1)
  rows.set('folder-ref', { ...rows.get('folder-ref')!, dismissed: true, version: 3 })
  await act(async () => root.render(<TeamMessagingPanel accountKey={account} intent={{ kind: 'link', publicRef: channel.publicRef }} />))
  expect(rows.get('folder-ref')?.dismissed).toBe(true)
  expect(call.mock.calls.filter(([op]) => op === 'team.app.entries.change')).toHaveLength(1)
})
