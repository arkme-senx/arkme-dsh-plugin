import { describe, expect, it } from 'vitest'
import { createArkmeSdk } from '../src/sdk/index.js'

function success(value: unknown): Response {
  return new Response(JSON.stringify({ ok: true, value }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('Arrangement consumer SDK', () => {
  it('exposes bounded list and opaque detail operations', async () => {
    const calls: Array<{ operation: string; params?: Record<string, unknown> }> = []
    const sdk = createArkmeSdk({
      fetchImpl: async (_input, init) => {
        const request = JSON.parse(String(init?.body)) as { operation: string; params?: Record<string, unknown> }
        calls.push(request)
        if (request.operation === 'arrangements.list') {
          return success({ items: [], total: 0, hasMore: false })
        }
        if (request.operation === 'arrangements.detail') {
          return success({ arrangementRef: 'arkme-arrangement-v1.ref', title: '评审方案', status: 'following' })
        }
        throw new Error(`unexpected ${request.operation}`)
      },
    })

    await expect(sdk.arrangements({ status: 'following', limit: 20, offset: 40 })).resolves.toEqual({
      items: [], total: 0, hasMore: false,
    })
    await expect(sdk.arrangementDetail('arkme-arrangement-v1.ref')).resolves.toMatchObject({
      arrangementRef: 'arkme-arrangement-v1.ref', status: 'following',
    })
    expect(calls).toEqual([
      { operation: 'arrangements.list', params: { status: 'following', limit: 20, offset: 40 } },
      { operation: 'arrangements.detail', params: { arrangementRef: 'arkme-arrangement-v1.ref' } },
    ])
  })

  it('rejects an empty arrangement reference before calling the Provider', async () => {
    const sdk = createArkmeSdk({ fetchImpl: async () => { throw new Error('must not fetch') } })

    await expect(sdk.arrangementDetail('  ')).rejects.toThrow('Arrangement reference must not be empty')
  })

  it('keeps lifecycle and reminder intents on explicit typed operations', async () => {
    const calls: Array<{ operation: string; params?: Record<string, unknown> }> = []
    const sdk = createArkmeSdk({
      fetchImpl: async (_input, init) => {
        const request = JSON.parse(String(init?.body)) as { operation: string; params?: Record<string, unknown> }
        calls.push(request)
        if (request.operation === 'arrangements.reminders.list') {
          return success({ items: [], total: 0, hasMore: false })
        }
        if (request.operation === 'arrangements.reminders.summary') return success({ unreadCount: 0 })
        if (request.operation === 'arrangements.mutate') {
          return success({ arrangementRef: request.params?.arrangementRef, intent: request.params?.intent, outcome: 'confirmed' })
        }
        if (request.operation === 'arrangements.reminder-enabled') {
          return success({ arrangementRef: request.params?.arrangementRef, enabled: request.params?.enabled, outcome: 'confirmed' })
        }
        if (request.operation === 'arrangements.reminders.mark-read') return success({ outcome: 'confirmed', updatedCount: 1 })
        if (request.operation === 'arrangements.reminders.mark-all-read') return success({ outcome: 'confirmed', updatedCount: 2 })
        if (request.operation === 'arrangements.reminders.clear') return success({ outcome: 'confirmed', updatedCount: 2 })
        throw new Error(`unexpected ${request.operation}`)
      },
    })

    await sdk.arrangementReminders({ unreadOnly: true, limit: 10, offset: 20 })
    await sdk.arrangementReminderSummary()
    await sdk.mutateArrangement('arrangement-ref', 'complete')
    await sdk.setArrangementReminderEnabled('arrangement-ref', true)
    await sdk.markArrangementRemindersRead(['event-ref-1'])
    await sdk.markAllArrangementRemindersRead()
    await sdk.clearArrangementReminders()

    expect(calls).toEqual([
      { operation: 'arrangements.reminders.list', params: { unreadOnly: true, limit: 10, offset: 20 } },
      { operation: 'arrangements.reminders.summary' },
      { operation: 'arrangements.mutate', params: { arrangementRef: 'arrangement-ref', intent: 'complete' } },
      { operation: 'arrangements.reminder-enabled', params: { arrangementRef: 'arrangement-ref', enabled: true } },
      { operation: 'arrangements.reminders.mark-read', params: { eventRefs: ['event-ref-1'] } },
      { operation: 'arrangements.reminders.mark-all-read' },
      { operation: 'arrangements.reminders.clear' },
    ])
  })

  it('rejects empty or duplicate reminder write references before calling the Provider', async () => {
    const sdk = createArkmeSdk({ fetchImpl: async () => { throw new Error('must not fetch') } })

    await expect(sdk.mutateArrangement('', 'complete')).rejects.toThrow('Arrangement reference must not be empty')
    await expect(sdk.markArrangementRemindersRead([])).rejects.toThrow('Reminder references must not be empty')
    await expect(sdk.markArrangementRemindersRead(['event-ref', 'event-ref']))
      .rejects.toThrow('Reminder references must be unique')
  })
})
