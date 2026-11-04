import { expect, it, vi } from 'vitest'
import { nanoCnyToPoints, pointsUnits, type ArkmeAiPointsConsumption, type ArkmeAiPointsPage } from '../src/ai-points.js'
import { PointsHistoryReader, pointsWindow } from '../src/client/ai-points-history.js'

const now = Date.parse('2026-11-04T09:00:00Z')
const scope = 'prod:11'
const call = (id: string, time: string, amount = '0.0000001', code = 'arkme'): ArkmeAiPointsConsumption => ({ requestUid: id, businessCode: code,
  createdAt: Date.parse(time), completedAt: Date.parse(time) + 1000, chargedPoints: amount, modelPoints: amount, grantedPoints: amount,
  purchasedPoints: '0', model: 'example', services: [], tokens: { cacheHitInput: '0', cacheMissInput: '0', output: '0' } })
const page = (month: string, items: ArkmeAiPointsConsumption[] = [], total?: string, next = ''): ArkmeAiPointsPage => ({
  accountScope: scope, unit: 'ai_points', month, items, chargedPoints: total ?? nanoCnyToPoints(items.reduce((sum, item) => sum + pointsUnits(item.chargedPoints), 0n).toString()), nextBeforeId: next,
})
const signal = () => new AbortController().signal

it('uses China days, Monday weeks and natural months over leap/year boundaries', () => {
  const day = pointsWindow('day', 0, now)
  expect(new Date(day.from).toISOString()).toBe('2026-10-20T16:00:00.000Z')
  expect(new Date(day.until).toISOString()).toBe('2026-11-04T16:00:00.000Z')
  const week = pointsWindow('week', 0, now)
  expect(new Date(week.periods.at(-1)!.from).toISOString()).toBe('2026-11-01T16:00:00.000Z')
  const month = pointsWindow('month', 0, now)
  expect(month.periods).toHaveLength(12); expect(month.periods[0]!.key).toBe('2025-12')
  const leap = pointsWindow('day', 0, Date.parse('2024-03-01T00:00:00Z'))
  expect(leap.periods.some(period => period.key === '2024-02-29')).toBe(true)
  expect(pointsWindow('day', 1, now).until).toBe(day.from)
  expect(() => pointsWindow('day', -1, now)).toThrow()
})

it('reads every page, checks exact totals, and assigns cross-midnight costs to the billing start day', async () => {
  const octOld = call('old', '2026-10-19T18:00:00Z', '1')
  const oct = call('oct', '2026-10-31T15:59:59Z', '0.0000001', 'agent')
  const nov = call('nov', '2026-10-31T16:00:00Z', '0.0000002', 'arrangement_recognition')
  const read = vi.fn(async (month: string, before: string) => month === '2026-10'
    ? before ? page(month, [octOld], '1.0000001') : page(month, [oct], '1.0000001', '10') : page(month, [nov]))
  const reader = new PointsHistoryReader(scope, read, () => now), window = pointsWindow('day', 0, now)
  const result = await reader.statistics(window, null, signal())
  expect(read).toHaveBeenCalledTimes(3)
  expect(result.chargedPoints).toBe('0.0000003')
  expect(result.buckets.find(bucket => bucket.key === '2026-10-31')!.chargedPoints).toBe('0.0000001')
  expect(result.buckets.find(bucket => bucket.key === '2026-11-01')!.chargedPoints).toBe('0.0000002')
  expect(result.items.map(item => item.requestUid)).toEqual(['nov', 'oct'])
  expect(result.categories.find(item => item.category === 'arko')!.chargedPoints).toBe('0.0000001')
  const selected = await reader.statistics(window, '2026-11-01', signal())
  expect(selected.selectedPoints).toBe('0.0000002'); expect(read).toHaveBeenCalledTimes(3)
})

it('reads only twelve first pages for the year chart, completing the selected month on demand', async () => {
  const read = vi.fn(async (month: string, before: string, _signal: AbortSignal, _limit: number) => before ? page(month, [call(`${month}-old`, `${month}-01T00:00:00Z`, '1')], '2')
    : page(month, [call(month, `${month}-02T00:00:00Z`, '1')], '2', '10'))
  const result = await new PointsHistoryReader(scope, read, () => now).statistics(pointsWindow('month', 0, now), '2026-11', signal())
  expect(read).toHaveBeenCalledTimes(13)
  expect(result.chargedPoints).toBe('24'); expect(result.selectedPoints).toBe('2'); expect(result.items).toHaveLength(2)
  expect(read.mock.calls.filter(([, cursor]) => cursor !== '')).toHaveLength(1)
  expect(read.mock.calls.filter(call => call[3] === 1)).toHaveLength(12)
})

it('retains a completed statement throughout an open dialog and rejects cross-month duplicate requests', async () => {
  let clock = now
  const read = vi.fn(async (month: string) => page(month, [call(month, `${month}-02T00:00:00Z`, '1')]))
  const reader = new PointsHistoryReader(scope, read, () => clock), window = pointsWindow('day', 0, now)
  await reader.statistics(window, null, signal()); clock += 120_000
  await reader.statistics(window, '2026-11-04', signal())
  expect(read).toHaveBeenCalledTimes(2)
  const duplicate = new PointsHistoryReader(scope, async month => page(month, [call('same-id', `${month}-02T00:00:00Z`, '1')]))
  await expect(duplicate.statistics(window, null, signal())).rejects.toMatchObject({ reason: 'invalid' })
})

it('restarts a changing statement once and never exposes a partial sum', async () => {
  let starts = 0
  const read = vi.fn(async (month: string, before: string) => {
    if (month !== '2026-11') return page(month)
    if (!before) { starts++; return page(month, [call('first', '2026-11-03T00:00:00Z', '1')], starts === 1 ? '2' : '3', '10') }
    return page(month, [call('second', '2026-11-02T00:00:00Z', '2')], '3')
  })
  const result = await new PointsHistoryReader(scope, read, () => now).statistics(pointsWindow('day', 0, now), null, signal())
  expect(starts).toBe(2); expect(result.chargedPoints).toBe('3')
})

it('retains the first reconciled snapshot when newer groups settle above its cursor', async () => {
  const read = async (month: string, cursor: string) => month !== '2026-11' ? page(month) : cursor
    ? page(month, [call('older', '2026-11-02T00:00:00Z', '1')], '3')
    : page(month, [call('first', '2026-11-03T00:00:00Z', '1')], '2', '10')
  const result = await new PointsHistoryReader(scope, read, () => now).statistics(pointsWindow('day', 0, now), null, signal())
  expect(result.chargedPoints).toBe('2'); expect(result.observedAt).toBe(now)
})

it.each(['scope', 'month', 'cursor', 'empty', 'duplicate', 'sum'] as const)('rejects malformed or incomplete %s statements', async kind => {
  const item = call('one', '2026-11-03T00:00:00Z', '1')
  const read = async (month: string, before: string) => {
    if (month !== '2026-11') return page(month)
    if (kind === 'scope') return { ...page(month), accountScope: 'prod:another' }
    if (kind === 'month') return { ...page(month), month: '2026-10' }
    if (kind === 'empty') return page(month, [], '1', '10')
    if (kind === 'sum') return page(month, [item], '2')
    return before ? page(month, [kind === 'duplicate' ? item : { ...item, requestUid: 'two' }], '2', kind === 'cursor' ? '10' : '') : page(month, [item], '2', '10')
  }
  await expect(new PointsHistoryReader(scope, read, () => now).statistics(pointsWindow('day', 0, now), null, signal())).rejects.toThrow()
})

it('aborts sibling work on failure and honors an already cancelled request', async () => {
  let sibling: AbortSignal | undefined
  const read = async (month: string, _cursor: string, request: AbortSignal) => {
    if (month === '2026-10') throw new Error('offline')
    sibling = request
    return new Promise<ArkmeAiPointsPage>((_resolve, reject) => request.addEventListener('abort', () => reject(request.reason), { once: true }))
  }
  const reader = new PointsHistoryReader(scope, read)
  await expect(reader.statistics(pointsWindow('day', 0, now), null, signal())).rejects.toThrow('offline')
  expect(sibling?.aborted).toBe(true)
  const controller = new AbortController(); controller.abort()
  await expect(reader.statistics(pointsWindow('day', 0, now), null, controller.signal)).rejects.toThrow()
})

it('bounds repeated pagination and discards cancelled late responses', async () => {
  let index = 0
  const read = vi.fn(async (month: string) => month !== '2026-11' ? page(month) : page(month,
    [call(String(index++), '2026-11-03T00:00:00Z', '1')], '999999', String(10000 - index)))
  await expect(new PointsHistoryReader(scope, read).statistics(pointsWindow('day', 0, now), null, signal())).rejects.toMatchObject({ reason: 'too-large' })
  expect(read.mock.calls.length).toBeLessThanOrEqual(162)
  const controller = new AbortController()
  let release!: (value: ArkmeAiPointsPage) => void
  const pending = new PointsHistoryReader(scope, async month => month === '2026-11' ? new Promise(resolve => { release = resolve }) : page(month))
    .statistics(pointsWindow('day', 0, now), null, controller.signal)
  controller.abort(); release(page('2026-11'))
  await expect(pending).rejects.toThrow()
})
