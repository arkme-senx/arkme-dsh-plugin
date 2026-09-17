import { expect, it } from 'vitest'
import { memberRecordsViewport, restoreMemberRecordsViewport } from '../src/client/member-records-viewport.js'

it.each([false, true])('uses a surviving visible record when the first anchor is deleted (all deleted: %s)', allDeleted => {
  let records = [{ id: 'first', top: 210 }, { id: 'next', top: 260 }]
  const body = {
    scrollTop: 200,
    getBoundingClientRect: () => ({ top: 0, bottom: 100 }),
    querySelectorAll: () => records.map(record => ({ dataset: { arkmeMemberRecordId: record.id },
      getBoundingClientRect: () => ({ top: record.top - body.scrollTop, bottom: record.top - body.scrollTop + 30 }) })),
  }
  const viewport = body as unknown as HTMLDivElement
  const snapshot = memberRecordsViewport(viewport)
  records = allDeleted ? [] : [{ id: 'next', top: 210 }]
  restoreMemberRecordsViewport(viewport, snapshot)
  expect(body.scrollTop).toBe(allDeleted ? 200 : 150)
})
