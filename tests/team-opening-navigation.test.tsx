// @vitest-environment jsdom
import { act, useSyncExternalStore } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { TeamOpen } from '../src/team-app-contract.js'
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
