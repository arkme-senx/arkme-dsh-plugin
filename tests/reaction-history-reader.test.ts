import { expect, it, vi } from 'vitest'
import { readReactionHistory } from '../src/client/reaction-history-reader.js'
import type { callArkme } from '../src/client/api.js'
const event = (id: string, at: number) => ({ event_uid: id, target_id: id, at, expression: { text: '赞' }, active: true, restricted: false })
it('merges independent cursors without dropping or duplicating rows, even at the same timestamp', async () => {
  const chat = [event('same', 300), ...Array.from({ length: 101 }, (_, i) => event(`c${i}`, 200-i))]
  const world = [event('same', 300), event('w', 299), event('old', 1)]
  const read = vi.fn(async (op, args) => {
    const source = op === 'reactions' ? chat : world
    const start = args.before_id ? source.findIndex(row => row.event_uid === args.before_id)+1 : 0
    const items = source.slice(start, start+100), last = items.at(-1)!
    return { items, has_more: start+100 < source.length, before_at: last?.at, before_id: last?.event_uid }
  }) as typeof callArkme
  const signal = new AbortController().signal
  const first = await readReactionHistory('test:7', 1, 400, signal, undefined, read)
  const second = await readReactionHistory('test:7', 1, 400, signal, first, read)
  const third = await readReactionHistory('test:7', 1, 400, signal, second, read)
  const rows = [...first.items, ...second.items, ...third.items]
  expect(rows).toHaveLength(105); expect(new Set(rows.map(row => row.event_uid)).size).toBe(105)
  expect(rows.map(row => row.at)).toEqual(rows.map(row => row.at).sort((a,b) => b-a))
  expect(third.has_more).toBe(false)
  expect(vi.mocked(read).mock.calls.filter(([op]) => op === 'world.reactions')).toHaveLength(1)
  expect(vi.mocked(read).mock.calls.at(-1)?.[1]).toMatchObject({ before_id: 'c98', accountKey: 'test:7' })
})
it('never substitutes chat results when World fails or the account request is cancelled', async () => {
  const read = vi.fn(async op => { if (op === 'world.reactions') throw Error('world offline'); return { items: [], has_more: false } })
  await expect(readReactionHistory('test:7', 1, 2, new AbortController().signal, undefined, read as typeof callArkme)).rejects.toThrow('world offline')
  const c = new AbortController(); c.abort()
  await expect(readReactionHistory('test:7', 1, 2, c.signal, undefined, read as typeof callArkme)).rejects.toThrow()
})
it('rejects empty unfinished pages and repeated cursors rather than looping', async () => {
  await expect(readReactionHistory('test:7', 1, 2, new AbortController().signal, undefined,
    vi.fn().mockResolvedValue({ items: [], has_more: true, before_at: 1, before_id: 'stuck' }) as typeof callArkme)).rejects.toThrow('分页')
})
