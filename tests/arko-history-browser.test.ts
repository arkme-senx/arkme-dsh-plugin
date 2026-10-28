import { expect, it } from 'vitest'
import { arkoHistoryDate, arkoHistoryKey, sortArkoHistory } from '../src/client/arko-history-browser.js'
import type { ArkmeArkoHistoryItem } from '../src/types.js'
const item = (id: number, display: number, order: number): ArkmeArkoHistoryItem => ({ messageId: id, sessionId: 7, role: 'user', text: '', reasoning: '', createdAtMillis: display, orderAtMillis: order, status: 1, createdRecordUids: [] })
it('keeps original display time distinct from stable history order and composite identity', () => {
  const earlier = item(1, 3000, 1000), later = item(2, 1000, 3000)
  expect(sortArkoHistory([later, earlier])).toEqual([earlier, later])
  expect(earlier.createdAtMillis).toBe(3000)
  expect(arkoHistoryKey(earlier)).toBe('7:1')
  expect(arkoHistoryDate(0)).toBe('')
  expect(arkoHistoryDate(NaN)).toBe('')
  expect(arkoHistoryDate(new Date(2026, 9, 18).getTime())).toBe('2026-10-18')
})
