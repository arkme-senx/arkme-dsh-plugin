import { expect, it } from 'vitest'
import type { DshAccountSession } from '../src/dsh-remote/account-session-types.js'
import { collapseAccountSessionCopies } from '../src/client/harness-session-copies.js'

const row = (overrides: Partial<DshAccountSession> = {}): DshAccountSession => ({
  runtimeRef: 'current', runtimeName: 'web:scope_home1', sessionRef: 'session1',
  workspaceRef: 'workspace1', workspaceName: 'repo', desktopName: 'Mac', sameDesktop: true,
  title: 'Conversation', updatedAt: 100, projectionAsOfSeq: 20, capabilities: ['session.native'],
  local: true, presence: 'online', running: false, blank: false, archived: false, origin: '', ...overrides,
})
const old = (overrides: Partial<DshAccountSession> = {}) => row({ runtimeRef: 'old', local: false, presence: 'offline', sameDesktop: false, ...overrides })

it('collapses old registrations into the current local source without mutating any row', () => {
  const current = row(), first = old(), second = old({ runtimeRef: 'older' })
  const rows = [first, current, second], before = structuredClone(rows)
  expect(collapseAccountSessionCopies(rows)).toEqual([current])
  expect(collapseAccountSessionCopies(rows)[0]).toBe(current)
  expect(rows).toEqual(before)
})

it('uses the online remote source and retains its capabilities and routing identity', () => {
  const online = row({ local: false, runtimeRef: 'other-device' })
  expect(collapseAccountSessionCopies([old(), online])).toEqual([online])
})

it.each([
  { runtimeName: 'web:scope_other' }, { workspaceRef: 'other-workspace' },
  { sessionRef: 'other-session' }, { desktopName: 'Windows' },
  { projectionAsOfSeq: 21 }, { updatedAt: 101 }, { title: 'Diverged' },
  { origin: 'subagent' }, { archived: true }, { blank: true }, { presence: 'unknown' as const },
])('keeps a distinct or ambiguous source: %j', difference => {
  const rows = [old(difference), row()]
  expect(collapseAccountSessionCopies(rows)).toBe(rows)
})

it.each(['web', 'cli', '', 'web:scope_'])('never deduplicates an unscoped profile %j', runtimeName => {
  const rows = [old({ runtimeName }), row({ runtimeName })]
  expect(collapseAccountSessionCopies(rows)).toBe(rows)
})

it.each([undefined, -2, NaN])('keeps incomplete journal evidence: %j', projectionAsOfSeq => {
  const rows = [old({ projectionAsOfSeq }), row()]
  expect(collapseAccountSessionCopies(rows)).toBe(rows)
})

it('collapses matching legacy snapshots before projection or workspace assignment', () => {
  const current = row({ projectionAsOfSeq: -1, workspaceRef: '' })
  const copy = old({ projectionAsOfSeq: -1, workspaceRef: '' })
  expect(collapseAccountSessionCopies([copy, current])).toEqual([current])
  const advanced = { ...current, projectionAsOfSeq: 21, updatedAt: 110, title: 'Continued conversation' }
  expect(collapseAccountSessionCopies([copy, advanced])).toEqual([advanced])
})

it('does not bring older snapshots back after the current journal advances or is archived', () => {
  const copy = old()
  const current = row({ title: 'Renamed', updatedAt: 110, projectionAsOfSeq: 22 })
  expect(collapseAccountSessionCopies([copy, current])).toEqual([current])
  const archived = { ...current, archived: true, projectionAsOfSeq: 23 }
  expect(collapseAccountSessionCopies([copy, archived])).toEqual([archived])
})

it('keeps independently live sources and their history', () => {
  const rows = [old(), row(), row({ runtimeRef: 'another-online', local: false })]
  expect(collapseAccountSessionCopies(rows)).toBe(rows)
})

it('retains offline-only history and keeps a stable representative when page order changes', () => {
  const a = old({ runtimeRef: 'a' }), b = old({ runtimeRef: 'b' })
  expect(collapseAccountSessionCopies([b, a])).toEqual([a])
  expect(collapseAccountSessionCopies([b, a], [b])).toEqual([b])
  expect(collapseAccountSessionCopies([a, b], [b])).toEqual([b])
  const newer = { ...a, updatedAt: 200, projectionAsOfSeq: 24 }
  expect(collapseAccountSessionCopies([newer, b], [b])).toEqual([newer])
})

it('retains unrelated rows and their original relative order', () => {
  const other = row({ sessionRef: 'another-session' }), current = row()
  expect(collapseAccountSessionCopies([other, old(), current])).toEqual([other, current])
})
