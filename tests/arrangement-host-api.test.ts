import { describe, expect, it, vi } from 'vitest'
import type { ArkmeService } from '../src/arkme-service.js'
import { dispatchArkmeHostOperation } from '../src/host-api.js'

describe('Arrangement Host operations', () => {
  it('dispatches only bounded list inputs and an opaque detail reference', async () => {
    const listArrangements = vi.fn(async (options: unknown) => options)
    const arrangementDetail = vi.fn(async (arrangementRef: string) => ({ arrangementRef }))
    const service = { listArrangements, arrangementDetail } as unknown as ArkmeService

    await expect(dispatchArkmeHostOperation(service, 'arrangements.list', {
      status: 'following', limit: 999, offset: -4, arrangementUid: 'must-not-cross-host',
    })).resolves.toEqual({ status: 'following', limit: 50, offset: 0 })
    await expect(dispatchArkmeHostOperation(service, 'arrangements.detail', {
      arrangementRef: 'arkme-arrangement-v1.ref', arrangementUid: 'must-not-cross-host',
    })).resolves.toEqual({ arrangementRef: 'arkme-arrangement-v1.ref' })

    expect(listArrangements).toHaveBeenCalledWith({ status: 'following', limit: 50, offset: 0 })
    expect(arrangementDetail).toHaveBeenCalledWith('arkme-arrangement-v1.ref')
  })

  it('normalizes unknown list status to all', async () => {
    const listArrangements = vi.fn(async (options: unknown) => options)
    const service = { listArrangements } as unknown as ArkmeService

    await expect(dispatchArkmeHostOperation(service, 'arrangements.list', {
      status: 'deleted', limit: Number.NaN, offset: Number.POSITIVE_INFINITY,
    })).resolves.toEqual({ status: 'all', limit: 20, offset: 0 })
  })

  it('dispatches explicit lifecycle and reminder operations without owner identities', async () => {
    const service = {
      mutateArrangement: vi.fn(async (arrangementRef: string, intent: string) => ({ arrangementRef, intent })),
      setArrangementReminderEnabled: vi.fn(async (arrangementRef: string, enabled: boolean) => ({ arrangementRef, enabled })),
      listArrangementReminders: vi.fn(async (options: unknown) => options),
      arrangementReminderSummary: vi.fn(async () => ({ unreadCount: 0 })),
      markArrangementRemindersRead: vi.fn(async (eventRefs: string[]) => ({ eventRefs })),
      markAllArrangementRemindersRead: vi.fn(async () => ({ outcome: 'confirmed' })),
      clearArrangementReminders: vi.fn(async () => ({ outcome: 'confirmed' })),
    }

    await dispatchArkmeHostOperation(service as never, 'arrangements.mutate', {
      arrangementRef: 'arrangement-ref', intent: 'complete', uid: 'must-not-cross-host',
    })
    await dispatchArkmeHostOperation(service as never, 'arrangements.reminder-enabled', {
      arrangementRef: 'arrangement-ref', enabled: true, uid: 'must-not-cross-host',
    })
    await dispatchArkmeHostOperation(service as never, 'arrangements.reminders.list', {
      unreadOnly: true, limit: 999, offset: -2,
    })
    await dispatchArkmeHostOperation(service as never, 'arrangements.reminders.summary', {})
    await dispatchArkmeHostOperation(service as never, 'arrangements.reminders.mark-read', {
      eventRefs: [' event-ref-1 ', 'event-ref-1', '', 42], eventUids: ['must-not-cross-host'],
    })
    await dispatchArkmeHostOperation(service as never, 'arrangements.reminders.mark-all-read', {})
    await dispatchArkmeHostOperation(service as never, 'arrangements.reminders.clear', {})

    expect(service.mutateArrangement).toHaveBeenCalledWith('arrangement-ref', 'complete')
    expect(service.setArrangementReminderEnabled).toHaveBeenCalledWith('arrangement-ref', true)
    expect(service.listArrangementReminders).toHaveBeenCalledWith({ unreadOnly: true, limit: 50, offset: 0 })
    expect(service.markArrangementRemindersRead).toHaveBeenCalledWith(['event-ref-1'])
    expect(service.markAllArrangementRemindersRead).toHaveBeenCalledOnce()
    expect(service.clearArrangementReminders).toHaveBeenCalledOnce()
  })

  it('rejects an unknown lifecycle intent before reaching the owner adapter', async () => {
    const mutateArrangement = vi.fn()
    const service = { mutateArrangement } as unknown as ArkmeService

    await expect(dispatchArkmeHostOperation(service, 'arrangements.mutate', {
      arrangementRef: 'arrangement-ref', intent: 'force-status',
    })).rejects.toMatchObject({ code: 'arrangement-intent-invalid', httpStatus: 400 })
    expect(mutateArrangement).not.toHaveBeenCalled()
  })

  it('rejects a missing reminder-enabled flag before reaching the owner adapter', async () => {
    const setArrangementReminderEnabled = vi.fn()
    const service = { setArrangementReminderEnabled } as unknown as ArkmeService

    await expect(dispatchArkmeHostOperation(service, 'arrangements.reminder-enabled', {
      arrangementRef: 'arrangement-ref',
    })).rejects.toMatchObject({ code: 'arrangement-reminder-enabled-invalid', httpStatus: 400 })
    expect(setArrangementReminderEnabled).not.toHaveBeenCalled()
  })
})
