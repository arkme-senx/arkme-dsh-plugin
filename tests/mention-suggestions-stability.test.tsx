// @vitest-environment jsdom
import { act, useMemo } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ArkmeMentionSuggestions } from '../src/client/ArkmeMentionSuggestions.js'
import { useMentionSuggestions, reconcileMentionSuggestions } from '../src/client/use-mention-suggestions.js'
import { arkmeGroupMentionCandidates, arkmeMentionCandidateKey, type ArkmeMentionCandidate } from '../src/client/mention-candidates.js'
import type { ArkmeConversationMemberItem, ArkmeGroupBotCandidate } from '../src/types.js'

vi.mock('../src/client/ArkmeAvatar.js', () => ({ ArkmeUserAvatar: ({ label }: { label: string }) => <span>{label}</span> }))
const members: ArkmeConversationMemberItem[] = ['甲', '乙'].map(name => ({ memberRef: name, mentionRef: name, displayName: name, mentionDisplayName: name,
  role: 'member', status: 'active', isSelf: false, isOwner: false, joinedAtMillis: 1, recordCount: 0, mentionCount: 0 }))
const bots: ArkmeGroupBotCandidate[] = [{ botRef: 'late', name: '晚到 Bot', description: '', installed: true }]
const emptyBots: ArkmeGroupBotCandidate[] = []
const rowStyles = { row: { height: 40 }, rowActive: { background: 'blue' }, avatar: {}, botAvatar: {}, text: {}, name: {}, secondary: {} }
let host: HTMLDivElement
let root: Root
let selected: ArkmeMentionCandidate | undefined
function Harness({ late = false, query = '', scope = 'a', remove = false, loading = true, open = true }: {
  late?: boolean; query?: string; scope?: string; remove?: boolean; loading?: boolean; open?: boolean
}) {
  const candidates = useMemo(() => open ? arkmeGroupMentionCandidates(query, late ? bots : emptyBots, remove ? members.slice(1) : members) : [], [late, query, remove, open])
  const session = useMentionSuggestions(scope, open ? { startIndex: 0, endIndex: query.length + 1, query } : undefined, candidates, loading)
  return <><input aria-label="输入" onKeyDown={event => {
    if (event.key === 'ArrowDown') session.move(1)
    if (event.key === 'ArrowUp') session.move(-1)
    if (event.key === 'Enter') selected = session.activeCandidate
  }} />{open && <ArkmeMentionSuggestions session={session} style={{ position: 'absolute', bottom: 20 }} rowStyles={rowStyles}
    loading={loading} error={false} onRetry={() => {}} onSelect={candidate => { selected = candidate }} />}</>
}
const rows = () => [...host.querySelectorAll<HTMLButtonElement>('[role="option"]')]
const key = (name: string) => act(() => host.querySelector('input')!.dispatchEvent(new KeyboardEvent('keydown', { key: name, bubbles: true })))
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  host = document.createElement('div'); document.body.append(host); root = createRoot(host); selected = undefined
})
afterEach(() => { act(() => root.unmount()); host.remove(); vi.unstubAllGlobals() })

describe('asynchronous mention candidates', () => {
  it('retains row identity, keyboard selection, height and scroll when a bot arrives above members in the source order', () => {
    act(() => root.render(<Harness />))
    const originalRows = rows()
    const popup = host.querySelector<HTMLElement>('[data-arkme-mention-popup]')!
    const height = popup.style.height
    const list = host.querySelector<HTMLElement>('[role="listbox"]')!
    list.scrollTop = 40
    key('ArrowDown'); key('ArrowDown')
    expect(rows()[2]!.getAttribute('aria-selected')).toBe('true')
    list.scrollTop = 40
    act(() => root.render(<Harness late loading={false} />))
    expect(rows().slice(0, 4)).toEqual(originalRows)
    expect(rows()[4]!.textContent).toContain('晚到 Bot')
    expect(popup.style.height).toBe(height)
    expect(list.scrollTop).toBe(40)
    expect(rows()[2]!.getAttribute('aria-selected')).toBe('true')
    key('Enter')
    expect(selected && arkmeMentionCandidateKey(selected)).toBe('member:甲')
  })
  it('keeps the hovered member under the same button after a delayed response', () => {
    act(() => root.render(<Harness />))
    const member = rows()[2]!
    act(() => member.dispatchEvent(new MouseEvent('mouseover', { bubbles: true })))
    act(() => root.render(<Harness late />))
    expect(rows()[2]).toBe(member)
    expect(member.getAttribute('aria-selected')).toBe('true')
    act(() => member.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })))
    expect(selected && arkmeMentionCandidateKey(selected)).toBe('member:甲')
  })
  it('keeps a disabled slot for a removed member and never silently selects the next person', () => {
    act(() => root.render(<Harness />)); key('ArrowDown'); key('ArrowDown')
    act(() => root.render(<Harness remove late />))
    expect(rows()[2]!.disabled).toBe(true)
    expect(rows()[3]!.textContent).toContain('乙')
    key('Enter'); expect(selected).toBeUndefined()
    key('ArrowDown'); key('Enter'); expect(selected?.kind).toBe('all')
  })
  it('resets order on a new query, account/conversation or reopening, not on background data arrival', () => {
    act(() => root.render(<Harness />)); key('ArrowDown')
    act(() => root.render(<Harness late scope="b" />))
    expect(rows()[1]!.textContent).toContain('晚到 Bot')
    expect(rows()[0]!.getAttribute('aria-selected')).toBe('true')
    act(() => root.render(<Harness late query="乙" loading={false} />))
    expect(rows()).toHaveLength(1); key('Enter'); expect(selected?.kind).toBe('member')
    act(() => root.render(<Harness open={false} />))
    act(() => root.render(<Harness late />))
    expect(rows()[1]!.textContent).toContain('晚到 Bot')
  })
  it('also appends newly loaded members and refreshes metadata in place', () => {
    const first = arkmeGroupMentionCandidates('', [], members.slice(0, 1))
    const session = reconcileMentionSuggestions(undefined, 'same', first, true)
    const changed = arkmeGroupMentionCandidates('', bots, [{ ...members[1]!, displayName: '乙新名字' }, members[0]!])
    const next = reconcileMentionSuggestions(session, 'same', changed, false)
    expect(next.rows.map(row => row.key)).toEqual(['all', 'bot:asen', 'member:甲', 'bot:late', 'member:乙'])
    expect(next.rows.at(-1)?.candidate.displayName).toBe('乙新名字')
  })
})
