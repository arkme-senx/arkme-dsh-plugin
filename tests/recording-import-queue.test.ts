import { describe, expect, it } from 'vitest'
import { RecordingImportQueue } from '../src/recording-import-queue.js'

describe('recording import execution queue', () => {
  it('runs a large FIFO backlog with bounded concurrency and keeps going after a failure', async () => {
    const queue = new RecordingImportQueue(2)
    const signal = new AbortController().signal
    let running = 0
    let peak = 0
    const started: number[] = []
    const tasks = Array.from({ length: 52 }, (_, index) => queue.run(async () => {
      running++
      peak = Math.max(peak, running)
      started.push(index)
      try {
        await new Promise(resolve => setTimeout(resolve, 1))
        if (index === 1) throw new Error('one file failed')
        return index
      } finally { running-- }
    }, signal))
    const results = await Promise.allSettled(tasks)
    expect(peak).toBe(2)
    expect(started).toEqual(Array.from({ length: 52 }, (_, i) => i))
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(51)
    expect(running).toBe(0)
  })

  it('cancels queued work immediately without waiting for a busy upload or consuming a slot', async () => {
    const queue = new RecordingImportQueue(1)
    let release!: () => void
    const first = queue.run(async () => { await new Promise<void>(resolve => { release = resolve }) }, new AbortController().signal)
    const controller = new AbortController()
    let started = false
    const cancelled = queue.run(async () => { started = true }, controller.signal)
    const rejected = expect(cancelled).rejects.toThrow('cancelled')
    controller.abort(new Error('cancelled'))
    await rejected
    release()
    await first
    await queue.run(async () => undefined, new AbortController().signal)
    expect(started).toBe(false)
  })
})
