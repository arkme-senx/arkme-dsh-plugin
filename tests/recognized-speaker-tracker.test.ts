import { describe, expect, it } from 'vitest'
import { RecognizedSpeakerTracker, markedSpeakerKeys } from '../src/client/recognized-speaker-tracker.js'
import type { ArkmeRecordingSpeakerCandidate } from '../src/types.js'
import type { UnmarkedSpeakerRow } from '../src/client/recognized-speaker-order.js'

const person = (id: string, owner = id): ArkmeRecordingSpeakerCandidate => ({ kind: 'speaker', optionKey: id, personKey: owner, speakerRef: id, label: '同名', isCurrentUser: false })
const voice = (id: string): UnmarkedSpeakerRow => ({ kind: 'unmarked-speaker', identityKey: id, candidateRef: `temporary-${id}`, displayName: '同名', subtitle: '' })
function fixture() {
  const data = new Map<string, string>()
  const store = { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value) } }
  return { tracker: new RecognizedSpeakerTracker(() => store), store }
}

describe('local recognized speaker visits', () => {
  it('counts merged people once, distinct same-name speakers separately and ignores contact suggestions', () => {
    expect(markedSpeakerKeys([person('a', 'owner'), person('b', 'owner'), person('c'), { ...person('d'), kind: 'arkme-user' }])).toHaveLength(2)
    const { tracker } = fixture()
    tracker.observe('a', [person('a', 'owner'), person('b', 'owner')], [voice('u1'), voice('u2')])
    expect(tracker.get('a')).toMatchObject({ total: 3, newCount: 0 })
  })
  it('quietly baselines history, accumulates genuinely new identities and clears after opening', () => {
    const { tracker } = fixture()
    tracker.observe('a', [], [voice('1')])
    tracker.observe('a', [], [voice('1'), voice('2')])
    tracker.observe('a', [], [voice('1'), voice('2'), voice('3')])
    expect(tracker.get('a').newCount).toBe(2)
    tracker.acknowledge('a')
    expect(tracker.get('a').newCount).toBe(0)
    tracker.observe('a', [], [voice('1'), voice('2'), voice('3'), voice('4')], true)
    expect(tracker.get('a').newCount).toBe(0)
    tracker.observe('a', [], [voice('1'), voice('2'), voice('3'), voice('4'), voice('5')])
    expect(tracker.get('a').newCount).toBe(1)
  })
  it('persists visits across restarts without depending on temporary action refs', () => {
    const { tracker, store } = fixture()
    tracker.observe('a', [], [voice('1')], true)
    const next = new RecognizedSpeakerTracker(() => store)
    next.observe('a', [], [{ ...voice('1'), candidateRef: 'new-runtime-ref' }, voice('2')])
    expect(next.get('a').newCount).toBe(1)
    next.observe('b', [], [voice('1'), voice('2')])
    expect(next.get('b').newCount).toBe(0)
  })
  it('does not mistake a merge, rename or disappearing/reappearing identity for a new person', () => {
    const { tracker } = fixture()
    tracker.observe('a', [], [voice('1'), voice('2')])
    tracker.observe('a', [person('merged')], [])
    expect(tracker.get('a')).toMatchObject({ total: 1, newCount: 0 })
    tracker.observe('a', [{ ...person('merged'), label: '改名' }], [voice('1')])
    expect(tracker.get('a').newCount).toBe(0)
  })
  it('suppresses ambiguous concurrent merge/recluster additions rather than falsely claiming exact new people', () => {
    const { tracker } = fixture()
    tracker.observe('a', [], [voice('1'), voice('2')])
    tracker.observe('a', [person('merged')], [voice('3')])
    expect(tracker.get('a')).toMatchObject({ total: 2, newCount: 0 })
  })
  it('does not acknowledge on partial/failing refresh or missing stable keys', () => {
    const { tracker } = fixture()
    tracker.observe('a', [], [voice('1')])
    tracker.observe('a', [], [voice('1'), voice('2')])
    tracker.uncertain('a')
    expect(tracker.get('a').newCount).toBeUndefined()
    tracker.observe('a', [], [{ kind: 'unmarked-speaker', candidateRef: 'opaque', displayName: 'x', subtitle: '' }], true)
    tracker.observe('a', [], [voice('1'), voice('2')])
    expect(tracker.get('a').newCount).toBe(1)
  })
  it('retains a total without inventing new counts when only the summary is known', () => {
    const { tracker } = fixture()
    tracker.setTotal('a', 123)
    expect(tracker.get('a')).toEqual({ total: 123, checkedAt: 0 })
    tracker.setTotal('a', Number.NaN)
    expect(tracker.get('a').total).toBe(123)
    tracker.clearSession()
    expect(tracker.get('a').total).toBeUndefined()
  })
  it('works for the session when preference storage is blocked', () => {
    const tracker = new RecognizedSpeakerTracker(() => { throw new Error('blocked') })
    tracker.observe('a', [], [voice('1')])
    tracker.observe('a', [], [voice('1'), voice('2')])
    expect(tracker.get('a').newCount).toBe(1)
  })
})
