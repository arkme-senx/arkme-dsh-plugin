import { afterEach, expect, it, vi } from 'vitest'
const api = vi.hoisted(() => vi.fn())
vi.mock('../src/client/api.js', () => ({ callArkme: api }))
import { toggleArrangementReminder } from '../src/client/arrangement-reminder.js'
const item = { arrangementRef: 'a', title: '安排', description: '', status: 'following' as const, reminderEnabled: false, reminderState: 'disabled', createdAtMillis: 1, updatedAtMillis: 10, version: 10 }
afterEach(() => { vi.useRealTimers(); api.mockReset() })
it.each([8, 9, 18])('saves the next local 09:00 before enabling when current hour is %i', async hour => {
 vi.useFakeTimers(); vi.setSystemTime(new Date(2026, 10, 11, hour))
 const expected = new Date(2026, 10, hour < 9 ? 11 : 12, 9).getTime()
 api.mockResolvedValueOnce({ state: 'applied', item: { ...item, remindAtMillis: expected, version: 11 } }).mockResolvedValueOnce({ item: { ...item, reminderEnabled: true, remindAtMillis: expected } })
 const applied = vi.fn()
 await toggleArrangementReminder(item, new AbortController().signal, applied)
 expect(api.mock.calls.map(c => c[0])).toEqual(['arrangements.edit', 'arrangements.reminder-enabled'])
 expect(api.mock.calls[0][1]).toEqual({ arrangementRef: 'a', expectedVersion: 10, remindAtMillis: expected })
 expect(applied).toHaveBeenLastCalledWith(expect.objectContaining({ reminderEnabled: true, remindAtMillis: expected }))
})
it('keeps an existing future time and does not edit when disabling', async () => {
 for (const reminderEnabled of [false, true]) {
  api.mockResolvedValueOnce({ item: { ...item, reminderEnabled: !reminderEnabled } })
  await toggleArrangementReminder({ ...item, reminderEnabled, remindAtMillis: Date.now() + 60000 }, new AbortController().signal, vi.fn())
 }
 expect(api.mock.calls.map(c => c[0])).toEqual(['arrangements.reminder-enabled', 'arrangements.reminder-enabled'])
})
it('does not enable after a conflicting time save', async () => {
 api.mockResolvedValueOnce({ state: 'conflict', item })
 await expect(toggleArrangementReminder(item, new AbortController().signal, vi.fn())).rejects.toThrow('conflict')
 expect(api).toHaveBeenCalledTimes(1)
})
