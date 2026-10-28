import { describe, expect, it } from 'vitest'
import type { ArkmeArrangementItem } from '../src/types.js'
import { arrangementMatchesView, arrangementViewRange, sortArrangementRows } from '../src/client/arrangement-workspace-model.js'

const item = (fields: Partial<ArkmeArrangementItem> = {}): ArkmeArrangementItem => ({ arrangementRef: 'one', title: '任务', description: '', status: 'following', reminderEnabled: false, reminderState: '', createdAtMillis: 0, updatedAtMillis: 0, ...fields })
describe('arrangement date views', () => {
  const now = new Date(2026, 9, 25, 17, 40).getTime()
  it('uses local calendar bounds and an inclusive server end', () => {
    expect(arrangementViewRange('today', now)).toEqual({ dueStartAtMillis: new Date(2026,9,25).getTime(), dueEndAtMillis: new Date(2026,9,26).getTime() - 1 })
    expect(arrangementViewRange('week', now)?.dueEndAtMillis).toBe(new Date(2026,10,1).getTime() - 1)
    expect(arrangementViewRange('all', now)).toBeUndefined()
  })
  it('does not treat creation time or reminder time as the arrangement date', () => {
    expect(arrangementMatchesView(item({ createdAtMillis: now, remindAtMillis: now }), 'today', now)).toBe(false)
    expect(arrangementMatchesView(item({ dueAtMillis: now }), 'today', now)).toBe(true)
    expect(arrangementMatchesView(item({ dueAtMillis: new Date(2026,9,26).getTime() }), 'today', now)).toBe(false)
    expect(arrangementMatchesView(item({ dueAtMillis: new Date(2026,10,1).getTime() }), 'week', now)).toBe(false)
  })
  it('keeps completed and deleted out of unfinished views', () => {
    expect(arrangementMatchesView(item({ dueAtMillis: now, status: 'completed' }), 'today', now)).toBe(false)
    expect(arrangementMatchesView(item({ status: 'completed' }), 'completed', now)).toBe(true)
    expect(arrangementMatchesView({ ...item(), status: 'deleted' }, 'all', now)).toBe(false)
    expect(arrangementMatchesView({ ...item(), status: 'deleted' }, 'deleted', now)).toBe(true)
  })
  it('merges status branches without duplicates and respects owner order', () => {
    const one = item({ arrangementRef: 'one', dueAtMillis: now, updatedAtMillis: 1 })
    const two = item({ arrangementRef: 'two', dueAtMillis: now + 1, updatedAtMillis: 3 })
    expect(sortArrangementRows([two,one,one], 'today').map(x => x.arrangementRef)).toEqual(['one','two'])
    expect(sortArrangementRows([two,one], 'all').map(x => x.arrangementRef)).toEqual(['two','one'])
  })
})
