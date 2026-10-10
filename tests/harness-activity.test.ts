import { expect, it } from 'vitest'
import { HarnessActivityTracker, parseHarnessActivity, type ActivitySession, type ActivityList } from '../src/client/harness-activity.js'

const session = (id: string, extra: Partial<ActivitySession> = {}): ActivitySession => ({ id, displayTitle: id, running: false, ...extra })
const list = (rows: ActivitySession[], current = 'a'): ActivityList => ({ phase: 'ready', ids: rows.map(row => row.id), byId: Object.fromEntries(rows.map(row => [row.id, row])), current })
const storage = () => { const data = new Map<string, string>(); return { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value) } } }

it('keeps an old, already-viewed conversation quiet on first load and after refresh', () => {
  const store = storage()
  const tracker = new HarnessActivityTracker('prod:42', store)
  expect(tracker.update(list([session('a')]), [], undefined)).toEqual({ scope: 'prod:42', current: { id: 'a', title: 'a' }, pending: [], running: [], unread: [] })
  expect(new HarnessActivityTracker('prod:42', store).update(list([session('a')]), [], undefined).unread).toEqual([])
})

it('reports the exact native destination, follows selection and rename, and distinguishes a new conversation from an unavailable selection', () => {
  const tracker = new HarnessActivityTracker('prod:42')
  const rows = [session('a', { displayTitle: '方案讨论' }), session('b', { displayTitle: '产品设计' })]
  expect(tracker.update(list(rows, 'a'), [], undefined).current).toEqual({ id: 'a', title: '方案讨论' })
  expect(tracker.update(list(rows, 'b'), [], undefined).current).toEqual({ id: 'b', title: '产品设计' })
  expect(tracker.update(list([rows[0]!, { ...rows[1]!, displayTitle: '新版产品设计' }], 'b'), [], undefined).current?.title).toBe('新版产品设计')
  expect(tracker.update(list([session('blank', { blank: true })], 'blank'), [], undefined).current?.title).toBe('新会话')
  expect(tracker.update({ phase: 'ready', ids: [], byId: {}, current: undefined }, [], undefined).current).toBeNull()
  expect(tracker.update(list(rows, 'missing'), [], undefined).current).toBeUndefined()
  expect(tracker.update({ ...list(rows), phase: 'pending' }, [], undefined).current).toBeUndefined()
  const malformed = { scope: 'prod:42', current: { id: 'a', title: 42 }, running: [], pending: [], unread: [] }
  expect(parseHarnessActivity(JSON.stringify(malformed), 'prod:42')).toBeUndefined()
})

it('counts conversations once, folds child activity into its parent, and gives pending interactions precedence', () => {
  const tracker = new HarnessActivityTracker('prod:42')
  const state = list([session('a', { running: true }), session('child', { origin: 'subagent', parentId: 'a', running: true }), session('b', { running: true }), session('c', { completed: true }), session('blank', { blank: true }), session('archived', { running: true })])
  const value = tracker.update(state, ['archived'], new Map([['child', { kind: 'question' }]]))
  expect(value.pending.map(row => row.id)).toEqual(['a'])
  expect(value.running.map(row => row.id)).toEqual(['b'])
  expect(value.unread.map(row => row.id)).toEqual(['c'])
  // A currently-visible question still requires action; viewing does not approve or dismiss it.
  expect(tracker.update(state, ['archived'], new Map([['child', { kind: 'question' }]]), 'a').pending).toHaveLength(1)
})

it('retains completion of a hidden selected conversation, persists it, and clears only the actually viewed conversation', () => {
  const store = storage()
  let tracker = new HarnessActivityTracker('prod:42', store)
  tracker.update(list([session('a', { running: true }), session('b', { running: true })]), [], undefined)
  const finished = list([session('a'), session('b', { completed: true })])
  expect(tracker.update(finished, [], undefined).unread.map(row => row.id)).toEqual(['a', 'b'])
  tracker = new HarnessActivityTracker('prod:42', store)
  tracker.update({ ...finished, phase: 'pending' }, [], undefined)
  expect(tracker.update(finished, [], undefined).unread).toHaveLength(2)
  expect(tracker.update(finished, [], undefined, 'a').unread.map(row => row.id)).toEqual(['b'])
  expect(tracker.update(finished, [], undefined, 'b').unread).toHaveLength(0)
  expect(tracker.update(finished, [], undefined).unread).toHaveLength(0) // A sticky native flag must not re-arm.
  tracker.update(list([session('a'), session('b', { running: true })]), [], undefined)
  expect(tracker.update(finished, [], undefined).unread.map(row => row.id)).toEqual(['b'])
})

it('does not remind for work completed in view, and removes archived/deleted reminders without crossing account scopes', () => {
  const store = storage()
  const tracker = new HarnessActivityTracker('prod:42', store)
  tracker.update(list([session('a', { running: true })]), [], undefined, 'a')
  expect(tracker.update(list([session('a')]), [], undefined, 'a').unread).toEqual([])
  tracker.update(list([session('a', { running: true }), session('b', { running: true })]), [], undefined)
  tracker.update(list([session('a'), session('b')]), [], undefined)
  expect(new HarnessActivityTracker('test:42', store).update(list([session('a'), session('b')]), [], undefined).unread).toEqual([])
  expect(tracker.update(list([session('a')]), ['a'], undefined).unread).toEqual([])
  expect(new HarnessActivityTracker('prod:42', store).update(list([session('a'), session('b')]), [], undefined).unread).toEqual([])
})

it('rejects stale-account or malformed bridge values and tolerates blocked local storage', () => {
  const tracker = new HarnessActivityTracker('prod:42', { getItem: () => { throw Error('blocked') }, setItem: () => { throw Error('blocked') } })
  tracker.update(list([session('a', { running: true })]), [], undefined)
  const value = tracker.update(list([session('a')]), [], undefined)
  expect(value.unread).toHaveLength(1)
  expect(parseHarnessActivity(JSON.stringify(value), 'prod:42')).toEqual(value)
  expect(parseHarnessActivity(JSON.stringify(value), 'prod:43')).toBeUndefined()
  expect(parseHarnessActivity('{"scope":"prod:42","running":3}', 'prod:42')).toBeUndefined()
})
