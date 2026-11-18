import { afterEach, expect, it, vi } from 'vitest'
import { measureConversationRead, measureConversationReadPhase, recordConversationReadPhase } from '../src/conversation-read-diagnostics.js'

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); vi.useRealTimers() })

it('does no timing/logging when disabled and returns the same result', async () => {
  vi.stubEnv('ARKME_CHAT_NOTIFICATION_DIAGNOSTICS', '0')
  const clock = vi.spyOn(performance, 'now')
  const log = vi.spyOn(console, 'info').mockImplementation(() => {})
  const result = { items: [] }
  expect(await measureConversationRead('source.timeline', async () => result)).toBe(result)
  expect(clock).not.toHaveBeenCalled()
  expect(log).not.toHaveBeenCalled()
})

it('bounds diagnostics and preserves failures without logging error text or unknown operations', async () => {
  vi.useFakeTimers(); vi.setSystemTime(new Date('2030-01-01'))
  vi.stubEnv('ARKME_CHAT_NOTIFICATION_DIAGNOSTICS', '1')
  const log = vi.spyOn(console, 'info').mockImplementation(() => {})
  const failure = Object.assign(new Error('secret token and message body'), { code: 'arkme-timeout' })
  await expect(measureConversationRead('source.timeline', async () => { throw failure })).rejects.toBe(failure)
  expect(log).toHaveBeenCalledWith('dsh-arkme: conversation_read', expect.objectContaining({ operation: 'source.timeline', ok: false, code: 'arkme-timeout' }))
  await measureConversationRead('secret-unknown-operation', async () => 1)
  for (let i = 0; i < 200; i++) await measureConversationRead('source.timeline', async () => 1)
  expect(log).toHaveBeenCalledTimes(120)
  expect(JSON.stringify(log.mock.calls)).not.toContain('secret')
  vi.advanceTimersByTime(60_001)
  await measureConversationRead('source.members.page', async () => 1)
  expect(log).toHaveBeenCalledTimes(121)
})


it('keeps concurrent read spans separate and reports phases even on a cache miss', async () => {
  vi.stubEnv('ARKME_CHAT_NOTIFICATION_DIAGNOSTICS', '1')
  vi.spyOn(console, 'info').mockImplementation(() => {})
  const first = vi.fn(), second = vi.fn()
  const miss = new Error('cache miss')
  await Promise.all([
    expect(measureConversationRead('source.timeline', () => measureConversationReadPhase('projection', async () => {
      await Promise.resolve()
      recordConversationReadPhase('sqlite', 7)
      throw miss
    }), first)).rejects.toBe(miss),
    measureConversationRead('source.timeline', async () => {
      recordConversationReadPhase('worker-queue', 42)
    }, second),
  ])
  expect(first.mock.calls[0]![0]).toContain('arkme-sqlite;dur=7.0')
  expect(first.mock.calls[0]![0]).not.toContain('worker-queue')
  expect(second).toHaveBeenCalledWith('arkme-worker-queue;dur=42.0')
})
