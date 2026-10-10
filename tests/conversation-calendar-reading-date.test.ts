// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { arkmeConversationReadingDate, arkmeConversationTargetScrollTop, arkmeConversationTargetRow } from '../src/client/conversation-viewport.js'

const date = (day: number) => new Date(2026, 6, day, 12).getTime()
const rows = [
  { kind: 'notice', id: 'notice:rule', occurredAtMillis: date(1) },
  { kind: 'message', id: 'message:record:first-occurrence', occurredAtMillis: date(2) },
  { kind: 'message', id: 'message:record:second-occurrence', occurredAtMillis: date(3) },
  { kind: 'message', id: 'message:last', occurredAtMillis: date(4) },
  { kind: 'notice', id: 'notice:later', occurredAtMillis: date(5) },
]
const rect = (top: number, height: number) => ({ top, bottom: top + height, height }) as DOMRect
function viewport() {
  const root = document.createElement('div')
  Object.defineProperties(root, { clientHeight: { value: 200 }, scrollHeight: { value: 800 } })
  root.getBoundingClientRect = () => rect(100, 200)
  rows.forEach((item, index) => {
    const row = document.createElement('li')
    row.dataset.arkmeConversationRow = item.id
    row.getBoundingClientRect = () => rect(100 + index * 100 - root.scrollTop, 100)
    root.append(row)
  })
  return root
}

describe('calendar follows the conversation reading position', () => {
  it('uses visible interaction cards, including the last interaction at the bottom', () => {
    const root = viewport()
    const mixed = rows.map((row, index) => index === 2 || index === 3 ? { ...row, kind: 'moment', id: `moment:${index}` } : row)
    mixed.forEach((row, index) => { (root.children[index] as HTMLElement).dataset.arkmeConversationRow = row.id })
    root.scrollTop = 200
    expect(arkmeConversationReadingDate(root, mixed)).toBe('2026-07-03')
    expect(arkmeConversationTargetRow(root, { itemUid: 'private-context', momentId: '2' })).toBe(root.children[2])
    root.scrollTop = 600
    expect(arkmeConversationReadingDate(root, mixed)).toBe('2026-07-04')
  })
  it('aligns calendar navigation at the top so reopening does not select the previous day', () => {
    const root = viewport()
    const row = root.children[2] as HTMLElement
    expect(arkmeConversationTargetScrollTop(root, row, 'center')).toBe(150)
    root.scrollTop = arkmeConversationTargetScrollTop(root, row, 'start')
    expect(root.scrollTop).toBe(200)
    expect(arkmeConversationReadingDate(root, rows)).toBe('2026-07-03')
  })
  it('ignores notices and selects the first visible message date across multiple days', () => {
    expect(arkmeConversationReadingDate(viewport(), rows)).toBe('2026-07-02')
  })
  it('follows scrolling by occurrence, including repeated records in different dates', () => {
    const root = viewport()
    root.scrollTop = 175
    expect(arkmeConversationReadingDate(root, rows)).toBe('2026-07-02')
    root.scrollTop = 200
    expect(arkmeConversationReadingDate(root, rows)).toBe('2026-07-03')
    root.scrollTop = 300
    expect(arkmeConversationReadingDate(root, rows)).toBe('2026-07-04')
  })
  it('uses the last message at the actual bottom, not a later system notice', () => {
    const root = viewport()
    root.scrollTop = 600
    expect(arkmeConversationReadingDate(root, rows)).toBe('2026-07-04')
    root.scrollTop = 598.5
    expect(arkmeConversationReadingDate(root, rows)).toBe('2026-07-04')
  })
  it('does not treat the wider auto-follow threshold as having reached the bottom', () => {
    const root = viewport()
    root.scrollTop = 530
    expect(arkmeConversationReadingDate(root, rows)).toBeUndefined()
  })
  it('returns no date for unmounted, empty, mismatched or invalid message windows', () => {
    expect(arkmeConversationReadingDate(null, rows)).toBeUndefined()
    expect(arkmeConversationReadingDate(document.createElement('div'), rows)).toBeUndefined()
    expect(arkmeConversationReadingDate(viewport(), [])).toBeUndefined()
    expect(arkmeConversationReadingDate(viewport(), rows.map(row => ({ ...row, id: `other:${row.id}` })))).toBeUndefined()
    expect(arkmeConversationReadingDate(viewport(), rows.map(row => ({ ...row, occurredAtMillis: NaN })))).toBeUndefined()
  })
})
