import { afterEach, describe, expect, it, vi } from 'vitest'
import * as realtime from '../src/chat-realtime.js'
import { MemberEventTimeline } from '../src/client/member-event-timeline.js'
import type { ArkmeMemberEvent, ArkmeMemberEventQuery } from '../src/types.js'

const event = (eventId: string, occurredAtMillis: number): ArkmeMemberEvent => ({ eventId, occurredAtMillis, type: 'left', displayName: '李四' })
afterEach(() => { vi.useRealTimers() })

describe('member event timeline', () => {
  it('reads each window once and fetches dense history only on a new scroll', async () => {
    const calls: ArkmeMemberEventQuery[] = []
    const timeline = new MemberEventTimeline(async q => {
      calls.push(q)
      return q.cursor === undefined
        ? { items: [event('c', 250), event('b', 200)], hasMore: true, nextCursor: 'page-2' }
        : { items: [event('a', 150)], hasMore: false }
    })
    await timeline.setWindow(100, 300)
    await timeline.setWindow(100, 300)
    expect(calls).toHaveLength(1)
    expect(timeline.snapshot().gaps[0]?.at).toBe(200)
    await timeline.loadGap(timeline.snapshot().gaps[0]!.id)
    expect(calls[1]).toMatchObject({ fromAtMillis: 100, toAtMillis: 300, cursor: 'page-2' })
    expect(timeline.snapshot().events.map(e => e.eventId)).toEqual(['a', 'b', 'c'])
    expect(timeline.snapshot().gaps).toEqual([])
    timeline.dispose()
  })

  it('extends history without re-reading the covered range, including when messages end', async () => {
    const calls: ArkmeMemberEventQuery[] = []
    const timeline = new MemberEventTimeline(async q => { calls.push(q); return { items: [], hasMore: false } })
    await timeline.setWindow(100, 300)
    await timeline.setWindow(50, 300)
    await timeline.setWindow(0, 300)
    expect(calls.map(q => [q.fromAtMillis, q.toAtMillis])).toEqual([[100,300],[50,99],[0,49]])
    timeline.dispose()
  })

  it('coalesces real hints, ignores duplicates, and does not poll or refresh merely on visibility', async () => {
    vi.useFakeTimers()
    const calls: ArkmeMemberEventQuery[] = []
    const timeline = new MemberEventTimeline(async q => { calls.push(q); return { items: [], hasMore: false } })
    await timeline.setWindow(100, 300)
    for (let i=0; i<20; i++) timeline.invalidate(`event-${i}`, 350)
    await vi.advanceTimersByTimeAsync(300)
    expect(calls).toHaveLength(2)
    timeline.invalidate('event-1', 350)
    timeline.setForeground(false)
    timeline.setForeground(true)
    await vi.advanceTimersByTimeAsync(60_000)
    expect(calls).toHaveLength(2)
    timeline.setForeground(false)
    timeline.invalidate('background-event', 400)
    await vi.advanceTimersByTimeAsync(60_000)
    expect(calls).toHaveLength(2)
    timeline.setForeground(true)
    await vi.advanceTimersByTimeAsync(300)
    expect(calls).toHaveLength(3)
    timeline.dispose()
  })

  it('retains rows after failures without retries, but clears unauthorized history', async () => {
    vi.useFakeTimers()
    let outcome: 'success' | 'failure' | 'forbidden' = 'success'
    let count = 0
    const timeline = new MemberEventTimeline(async () => {
      count++
      if (outcome === 'failure') throw new Error('network')
      if (outcome === 'forbidden') throw Object.assign(new Error('denied'), { code: 'member-events-unavailable' })
      return { items: [event('a',150)], hasMore:false }
    })
    await timeline.setWindow(100,300)
    outcome='failure'; timeline.invalidate('b',200)
    await vi.advanceTimersByTimeAsync(60_000)
    expect(count).toBe(2)
    expect(timeline.snapshot().events).toHaveLength(1)
    outcome='forbidden'; timeline.invalidate('c',200)
    await vi.advanceTimersByTimeAsync(300)
    expect(timeline.snapshot().events).toEqual([])
    expect(timeline.snapshot().unavailable).toBe(true)
    timeline.dispose()
  })

  it('ignores a response after disposal and never runs two requests concurrently', async () => {
    let finish!: (page: {items: ArkmeMemberEvent[]; hasMore:boolean}) => void
    let count=0
    const timeline=new MemberEventTimeline(async () => { count++; return await new Promise(resolve => { finish=resolve }) })
    const first=timeline.setWindow(100,300)
    const second=timeline.setWindow(50,300)
    expect(count).toBe(1)
    timeline.dispose()
    finish({items:[event('late',200)],hasMore:false})
    await Promise.all([first,second])
    expect(count).toBe(1)
    expect(timeline.snapshot().events).toEqual([])
  })
})

it('decodes owner event hints without accepting member identity or message counters', () => {
  const decode = (realtime as unknown as { decodeArkmeMemberEventDataLine: (line:string)=>unknown }).decodeArkmeMemberEventDataLine
  expect(decode).toBeTypeOf('function')
  const frame = { t:27,event_uid:'leave-1',chat_session_uid:'group-1',event_at:1234 }
  expect(decode(`data: ${JSON.stringify(frame)}`)).toEqual({eventUid:'leave-1',chatSessionUid:'group-1',eventAtMillis:1234})
  expect(decode(`data: ${JSON.stringify({...frame,member_user_id:123})}`)).toBeUndefined()
})
