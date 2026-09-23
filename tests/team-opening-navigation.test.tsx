// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { TeamOpen } from '../src/team-app-contract.js'
import { TeamMessagingMount } from '../src/client/TeamMessagingPanel.js'
import { openTeamMessages } from '../src/client/team-messaging-events.js'

const mocks = vi.hoisted(() => ({ call: vi.fn() }))
vi.mock('../src/client/api.js', () => ({ callArkme: mocks.call }))
let root: Root, host: HTMLDivElement
const tick = async () => { await Promise.resolve(); await Promise.resolve() }
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal('IntersectionObserver', class { observe() {} disconnect() {} })
  mocks.call.mockReset()
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
})
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals() })

it.each(['success', 'failure'])('explicit side selection supersedes late channel %s', async outcome => {
  let resolve!: (value: TeamOpen) => void, reject!: (error: Error) => void
  const pending = new Promise<TeamOpen>((ok, no) => { resolve = ok; reject = no })
  mocks.call.mockImplementation(async (op: string) => {
    if (op === 'team.app.attention') return {team:false, external:false, applications:false}
    if (op === 'team.app.teams') return []
    if (op === 'team.app.conversations') return {items:[], hasMore:false}
    if (op === 'team.app.open') return pending
    throw new Error(op)
  })
  await act(async () => { root.render(<TeamMessagingMount accountKey="navigation-test" active />); await tick() })
  await act(async () => { openTeamMessages({kind:'link', publicRef:'a'.repeat(32)}); await tick() })
  const button = () => [...document.querySelectorAll('button')].find(b => b.textContent === '团队收件箱')!
  await act(async () => { button().click(); await tick() })
  await act(async () => {
    if(outcome === 'failure') reject(new Error('old opening failed'))
    else resolve({channel:{teamRef:'old-team', name:'旧入口', jotmoId:'old_team', publicRef:'a'.repeat(32),link:'',enabled:true,revision:1,canManage:false},openInbox:false,
      conversation:{ref:'old-conversation',key:'old',channel:{teamRef:'old-team', name:'旧入口', jotmoId:'old_team',publicRef:'a'.repeat(32),link:'',enabled:true,revision:1,canManage:false},side:'external',lastSeq:0,latestTeamReplySeq:0,myReadSeq:0,unread:0,needsReply:false,blocked:false,revision:1,updatedAt:1}})
    await tick()
  })
  expect(button().getAttribute('aria-pressed')).toBe('true')
  expect(document.body.textContent).not.toContain('old opening failed')
  expect(mocks.call.mock.calls.some(([op]) => op === 'team.app.timeline')).toBe(false)
})
