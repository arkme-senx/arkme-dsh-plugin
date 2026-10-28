import { describe, expect, it, vi } from 'vitest'
import type { ArkmeService } from '../src/arkme-service.js'
import { dispatchArkmeHostOperation } from '../src/host-api.js'

describe('Arrangement Host operations', () => {
  it('keeps deleted reads separate, bounded, cancellable, and account-owned', async () => {
    const deletedArrangements = vi.fn(async () => ({items:[]})), deletedArrangementDetail = vi.fn(async () => ({}))
    const service = {deletedArrangements,deletedArrangementDetail} as unknown as ArkmeService
    const signal = new AbortController().signal
    await dispatchArkmeHostOperation(service,'arrangements.deleted.list',{limit:999,offset:-2,userId:88},undefined,undefined,undefined,undefined,signal)
    await dispatchArkmeHostOperation(service,'arrangements.deleted.detail',{arrangementRef:'opaque',uid:'ignored',userId:88},undefined,undefined,undefined,undefined,signal)
    expect(deletedArrangements).toHaveBeenCalledWith({limit:50,offset:0,signal})
    expect(deletedArrangementDetail).toHaveBeenCalledWith('opaque',signal)
  })
  it.each([{dateContext:null}, {dateContext:[]}, {dateContext:'2026-10-20'}, {dueAtMillis:1792458000000}])('rejects malformed or legacy creation dates before any write: %j', async params => {
    const createArrangement = vi.fn()
    await expect(dispatchArkmeHostOperation({createArrangement} as unknown as ArkmeService, 'arrangements.create', {requestId:'test',texts:['开会'],...params})).rejects.toMatchObject({code:'arrangement-create-invalid'})
    expect(createArrangement).not.toHaveBeenCalled()
  })
  it('forwards cancellation and only allowed date context fields', async () => {
    const createArrangement = vi.fn(async () => ({items:[]}))
    const signal = new AbortController().signal
    await dispatchArkmeHostOperation({createArrangement} as unknown as ArkmeService, 'arrangements.create', {
      requestId:'context', texts:['开会'], userId:999, dateContext:{defaultDate:'2026-10-20',timezone:'Asia/Shanghai',userId:999},
    }, undefined, undefined, undefined, undefined, signal)
    expect(createArrangement).toHaveBeenCalledWith({requestId:'context',texts:['开会'],dateContext:{defaultDate:'2026-10-20',timezone:'Asia/Shanghai'}},signal)
  })
  it('uses a dedicated source-day operation without trusting browser owner IDs', async () => {
    const recordingDayArrangements = vi.fn(async (options: unknown) => options)
    await dispatchArkmeHostOperation({ recordingDayArrangements } as unknown as ArkmeService, 'arrangements.recording-day', { dateStamp: 1791475200000, tzOffsetMillis: 28800000, limit: 900, offset: 20, snapshotVersion: 'snapshot', userId: 99 })
    expect(recordingDayArrangements).toHaveBeenCalledWith({ dateStamp: 1791475200000, tzOffsetMillis: 28800000, limit: 50, offset: 20, snapshotVersion: 'snapshot' }, undefined)
  })
  it('carries explicit arrangement dates through the host boundary', async () => {
    const createArrangement = vi.fn(async (input: unknown) => input)
    const listArrangements = vi.fn(async (input: unknown) => input)
    const service = { createArrangement, listArrangements } as unknown as ArkmeService
    await dispatchArkmeHostOperation(service, 'arrangements.create', { requestId:'dated', texts:['开会'], dateContext:{defaultDate:'2026-10-20',timezone:'Asia/Shanghai'} })
    expect(createArrangement).toHaveBeenCalledWith({ requestId:'dated', texts:['开会'], dateContext:{defaultDate:'2026-10-20',timezone:'Asia/Shanghai'} }, undefined)
    await dispatchArkmeHostOperation(service, 'arrangements.list', { dueStartAtMillis:1000, dueEndAtMillis:2000 })
    expect(listArrangements).toHaveBeenCalledWith({ status:'all', limit:20, offset:0, dueStartAtMillis:1000, dueEndAtMillis:2000 })
  })
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

it('dispatches versioned board list and reorder with opaque anchors only', async () => {
  const service = { listArrangements: vi.fn(async (value: unknown) => value), reorderArrangement: vi.fn(async (value: unknown) => value) } as unknown as ArkmeService
  await expect(dispatchArkmeHostOperation(service, 'arrangements.list', { status: 'identified', order: 'board', boardVersion: 'v1' })).resolves.toMatchObject({ order: 'board', boardVersion: 'v1' })
  await expect(dispatchArkmeHostOperation(service, 'arrangements.reorder', { arrangementRef: 'ref', status: 'identified', afterRef: 'after', boardVersion: 'v1', requestId: 'r1', uid: 'secret' })).resolves.toEqual({ arrangementRef: 'ref', status: 'identified', afterRef: 'after', boardVersion: 'v1', requestId: 'r1' })
  await expect(dispatchArkmeHostOperation(service, 'arrangements.reorder', { arrangementRef: 'ref', status: 'all' })).rejects.toMatchObject({ httpStatus: 400 })
})

it('keeps creation identity and recognition queries on the opaque host contract', async () => {
 const service={createArrangement:vi.fn(async()=>({items:[]})),arrangementRecognition:vi.fn(async()=>({items:[]}))}
 await dispatchArkmeHostOperation(service as never,'arrangements.create',{requestId:'create-1',texts:['开会'],userId:99,topicUid:'not-allowed',uid:'not-allowed'})
 expect(service.createArrangement).toHaveBeenCalledWith({requestId:'create-1',texts:['开会']},undefined)
 await dispatchArkmeHostOperation(service as never,'arrangements.recognition',{arrangementRefs:['opaque'],uids:['not-allowed']})
 expect(service.arrangementRecognition).toHaveBeenCalledWith(['opaque'])
})

it('reads a source quote with opaque references and forwards cancellation', async () => {
  const arrangementSourceRead = vi.fn(async () => ({ state: 'ready', evidenceId: 'e', text: '原句' }))
  const signal = new AbortController().signal
  await dispatchArkmeHostOperation({ arrangementSourceRead } as unknown as ArkmeService, 'arrangements.source.read', { arrangementRef: 'a', evidenceId: 'e', userId: 99, uid: 'must-not-cross-host' }, undefined, undefined, undefined, undefined, signal)
  expect(arrangementSourceRead).toHaveBeenCalledWith('a', 'e', signal)
})
