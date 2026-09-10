import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ArkmeRecordReeditSubmissionView } from '../src/record-reedit-contract.js'
import type { ArkmeTimelineItem } from '../src/types.js'

const mocks = vi.hoisted(() => ({ callArkme: vi.fn() }))
vi.mock('../src/client/api.js', () => ({ callArkme: mocks.callArkme }))

import { projectRecordReedit, useRecordReeditSubmissions } from '../src/client/record-reedit-submissions.js'

const original: ArkmeTimelineItem = {
  itemUid: 'record-a', title: '', textContent: '原正文', status: 1, version: 3, sendAtMillis: 1,
}
const committed: ArkmeRecordReeditSubmissionView = {
  submissionId: 'submission-a', itemUid: original.itemUid, state: 'committed', baseVersion: 3,
  title: '', textContent: '保存后的正文', attachments: [],
  result: { status: 'committed', itemUid: original.itemUid, version: 4, revisionUid: 'revision-a', projectionState: 'pending' },
}

describe('record re-edit submission hook owns canonical handoff', () => {
  let renderer: ReactTestRenderer | undefined
  let state: ReturnType<typeof useRecordReeditSubmissions>
  let receipts: ArkmeRecordReeditSubmissionView[]
  const refreshCurrentWindow = vi.fn<() => Promise<void>>()
  const flush = async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve() }
  type Props = {
    sourceKey?: string
    sourceRef?: string
    accountKey?: string
    active?: boolean
    items: readonly ArkmeTimelineItem[]
    refresh?: () => Promise<void>
  }
  function Probe({ sourceRef = 'source-a', sourceKey = sourceRef, accountKey = 'account-a', active = true, items, refresh = refreshCurrentWindow }: Props) {
    state = useRecordReeditSubmissions(sourceRef, accountKey, active, items, refresh, sourceKey)
    return null
  }
  const mount = async (props: Props) => {
    await act(async () => { renderer = create(<Probe {...props} />); await flush() })
  }
  const update = async (props: Props) => {
    await act(async () => { renderer!.update(<Probe {...props} />); await flush() })
  }
  const acknowledgeCalls = () => mocks.callArkme.mock.calls.filter(([operation]) => operation === 'source.record-reedit.acknowledge')
  const readCalls = () => mocks.callArkme.mock.calls.filter(([operation]) => operation === 'source.record-reedit.submissions')

  beforeEach(() => {
    vi.useFakeTimers()
    receipts = [committed]
    refreshCurrentWindow.mockReset().mockResolvedValue(undefined)
    mocks.callArkme.mockReset().mockImplementation(async operation =>
      operation === 'source.record-reedit.submissions' ? [...receipts] : {})
  })
  afterEach(() => {
    act(() => renderer?.unmount())
    vi.useRealTimers()
  })

  it.each(['empty', 'failed', 'outside-window'] as const)('stops polling after discovering %s receipts', async kind => {
    receipts = kind === 'empty' ? [] : kind === 'outside-window' ? [committed]
      : [{ ...committed, state: kind, result: undefined } as ArkmeRecordReeditSubmissionView]
    await mount({ items: kind === 'outside-window' ? [] : [original] })
    expect(readCalls()).toHaveLength(1)
    await act(async () => { await vi.advanceTimersByTimeAsync(6000) })
    expect(readCalls()).toHaveLength(1)
    expect(state.jobs).toEqual(receipts)
  })

  it('restarts polling for a newly accepted edit and stops after canonical acknowledgement', async () => {
    receipts = []
    await mount({ items: [original] })
    const pending = { ...committed, state: 'pending', result: undefined } as ArkmeRecordReeditSubmissionView
    receipts = [pending]
    await act(async () => { state.accepted(pending); await flush() })
    const readsAfterAccept = readCalls().length
    await act(async () => { await vi.advanceTimersByTimeAsync(1500) })
    expect(readCalls().length).toBeGreaterThan(readsAfterAccept)
    expect(state.jobs).toEqual([pending])
    receipts = [committed]
    await update({ items: [{ ...original, recordVersion: 4, mediaUnavailable: false }] })
    mocks.callArkme.mockImplementation(async operation => {
      if (operation === 'source.record-reedit.acknowledge') receipts = []
      return operation === 'source.record-reedit.submissions' ? [...receipts] : {}
    })
    await act(async () => { await vi.advanceTimersByTimeAsync(1500) })
    await act(async () => { await vi.advanceTimersByTimeAsync(1500) })
    expect(acknowledgeCalls()).toHaveLength(1)
    expect(state.jobs).toEqual([])
    const settledReads = readCalls().length
    await act(async () => { await vi.advanceTimersByTimeAsync(6000) })
    expect(readCalls()).toHaveLength(settledReads)
  })

  it('retries failed discovery without treating it as an empty queue', async () => {
    receipts = []
    let failRead = true
    mocks.callArkme.mockImplementation(async operation => {
      if (operation === 'source.record-reedit.submissions') {
        if (failRead) throw new Error('read unavailable')
        return [...receipts]
      }
      return {}
    })
    await mount({ items: [original] })
    failRead = false
    await act(async () => { await vi.advanceTimersByTimeAsync(1500) })
    expect(readCalls()).toHaveLength(2)
    await act(async () => { await vi.advanceTimersByTimeAsync(6000) })
    expect(readCalls()).toHaveLength(2)
  })

  it('discovers restored work with renewed credentials after idle polling stopped', async () => {
    receipts = []
    await mount({ sourceKey: 'stable-source', items: [original] })
    receipts = [committed]
    await update({ sourceKey: 'stable-source', sourceRef: 'renewed-ref', items: [original] })
    expect(state.jobs).toEqual([committed])
    expect(refreshCurrentWindow).toHaveBeenCalledExactlyOnceWith()
  })

  it('keeps following an unknown outcome until an explicit asynchronous reconciliation completes', async () => {
    receipts = [{ ...committed, state: 'uncertain', result: undefined } as ArkmeRecordReeditSubmissionView]
    await mount({ items: [original] })
    await act(async () => { await state.refresh(true) })
    expect(state.jobs[0]?.state).toBe('uncertain')
    receipts = [committed]
    await act(async () => { await vi.advanceTimersByTimeAsync(1500) })
    expect(state.jobs).toEqual([committed])
    expect(refreshCurrentWindow).toHaveBeenCalledExactlyOnceWith()
  })

  it.each([
    { name: 'complete committed version', patch: { recordVersion: 4, mediaUnavailable: false } },
    { name: 'newer partial version', patch: { recordVersion: 5, mediaUnavailable: true } },
    { name: 'deleted committed version', patch: { recordVersion: 4, mediaUnavailable: true, status: 0 } },
  ])('acknowledges the $name from canonical items', async ({ patch }) => {
    await mount({ items: [{ ...original, ...patch }] })
    expect(acknowledgeCalls()).toEqual([['source.record-reedit.acknowledge', {
      sourceRef: 'source-a', submissionId: committed.submissionId, version: 4,
    }]])
    expect(refreshCurrentWindow).not.toHaveBeenCalled()
  })

  it('retains a same-version partial candidate and refreshes the current window on the existing receipt cadence', async () => {
    const partial = { ...original, recordVersion: 4, mediaUnavailable: true, contentBlocks: [] }
    await mount({ items: [partial] })
    expect(projectRecordReedit(partial, state.jobs)).toMatchObject({ textContent: committed.textContent, mediaUnavailable: false })
    expect(acknowledgeCalls()).toEqual([])
    expect(refreshCurrentWindow).toHaveBeenCalledExactlyOnceWith()

    const refreshUpdatedWindow = vi.fn<() => Promise<void>>().mockResolvedValue(undefined)
    await update({ items: [{ ...partial }], refresh: refreshUpdatedWindow })
    expect(refreshUpdatedWindow).not.toHaveBeenCalled()
    await act(async () => { await vi.advanceTimersByTimeAsync(1500) })
    expect(refreshCurrentWindow).toHaveBeenCalledTimes(1)
    expect(refreshUpdatedWindow).toHaveBeenCalledExactlyOnceWith()
    expect(acknowledgeCalls()).toEqual([])

    await update({ items: [{ ...partial, mediaUnavailable: false }], refresh: refreshUpdatedWindow })
    await act(async () => { await vi.advanceTimersByTimeAsync(1500) })
    expect(acknowledgeCalls()).toHaveLength(1)
    expect(refreshUpdatedWindow).toHaveBeenCalledTimes(1)
  })

  it('does not refresh or acknowledge a receipt for a record outside the current window', async () => {
    await mount({ items: [{ ...original, itemUid: 'another-record' }] })
    await act(async () => { await vi.advanceTimersByTimeAsync(3000) })
    expect(state.jobs).toEqual([committed])
    expect(acknowledgeCalls()).toEqual([])
    expect(refreshCurrentWindow).not.toHaveBeenCalled()

    await update({ items: [original] })
    expect(refreshCurrentWindow).not.toHaveBeenCalled()
    await act(async () => { await vi.advanceTimersByTimeAsync(1500) })
    expect(refreshCurrentWindow).toHaveBeenCalledExactlyOnceWith()
  })

  it.each(['source', 'identity', 'account', 'inactive'] as const)('does not hand off old receipts after a %s scope change', async kind => {
    let resolveOldRead!: (value: ArkmeRecordReeditSubmissionView[]) => void
    const oldRead = new Promise<ArkmeRecordReeditSubmissionView[]>(resolve => { resolveOldRead = resolve })
    mocks.callArkme.mockImplementation(async operation => operation === 'source.record-reedit.submissions' ? oldRead : {})
    await mount({ items: [original] })
    const acceptOld = state.accepted
    await act(async () => { acceptOld(committed); await flush() })
    expect(refreshCurrentWindow).toHaveBeenCalledExactlyOnceWith()

    mocks.callArkme.mockImplementation(async operation => operation === 'source.record-reedit.submissions' ? [] : {})
    const refreshNewWindow = vi.fn<() => Promise<void>>().mockResolvedValue(undefined)
    await update({
      sourceRef: kind === 'source' ? 'source-b' : 'source-a',
      ...(kind === 'identity' ? { sourceKey: 'different-source' } : {}),
      accountKey: kind === 'account' ? 'account-b' : 'account-a',
      active: kind !== 'inactive',
      items: [{ ...original, recordVersion: 4 }], refresh: refreshNewWindow,
    })
    await act(async () => { resolveOldRead([committed]); acceptOld(committed); await flush() })
    await act(async () => { await vi.advanceTimersByTimeAsync(1500) })
    expect(state.jobs).toEqual([])
    expect(acknowledgeCalls()).toEqual([])
    expect(refreshNewWindow).not.toHaveBeenCalled()
    expect(refreshCurrentWindow).toHaveBeenCalledTimes(1)
  })

  it('retains receipts after a refresh failure and retries through the existing poller', async () => {
    refreshCurrentWindow.mockRejectedValueOnce(new Error('timeline unavailable'))
    await mount({ items: [original] })
    expect(state.jobs).toEqual([committed])
    expect(refreshCurrentWindow).toHaveBeenCalledTimes(1)
    await act(async () => { await vi.advanceTimersByTimeAsync(1500) })
    expect(refreshCurrentWindow).toHaveBeenCalledTimes(2)
    expect(acknowledgeCalls()).toEqual([])
    expect(mocks.callArkme.mock.calls.filter(([operation]) => operation === 'source.record-reedit.resume')).toHaveLength(1)
  })

  it('retains known receipts during a same-source capability renewal and failed read', async () => {
    await mount({ sourceKey: 'stable-source', items: [original] })
    const acceptBeforeRenewal = state.accepted
    mocks.callArkme.mockImplementation(async operation => {
      if (operation === 'source.record-reedit.submissions') throw new Error('read unavailable')
      return {}
    })
    await update({ sourceKey: 'stable-source', sourceRef: 'renewed-ref', items: [original] })
    expect(state.jobs).toEqual([committed])
    const next = { ...committed, submissionId: 'new-submit', textContent: '新接受的候选' }
    await act(async () => { acceptBeforeRenewal(next); await flush() })
    expect(state.jobs).toEqual([next])
  })

  it.each([false, true])('rejects the old capability read without rejecting a same-source accepted receipt (returns to original ref: %s)', async returnsToOriginalRef => {
    let resolveOld!: (value: ArkmeRecordReeditSubmissionView[]) => void
    const oldRead = new Promise<ArkmeRecordReeditSubmissionView[]>(resolve => { resolveOld = resolve })
    mocks.callArkme.mockImplementation(async operation => operation === 'source.record-reedit.submissions' ? oldRead : {})
    await mount({ sourceKey: 'stable-source', items: [original] })
    const acceptBeforeRenewal = state.accepted
    mocks.callArkme.mockImplementation(async operation => operation === 'source.record-reedit.submissions' ? [committed] : {})
    await update({ sourceKey: 'stable-source', sourceRef: 'renewed-ref', items: [original] })
    if (returnsToOriginalRef) await update({ sourceKey: 'stable-source', items: [original] })
    await act(async () => { resolveOld([]); await flush() })
    expect(state.jobs).toEqual([committed])
    await act(async () => { acceptBeforeRenewal({ ...committed, textContent: '最新候选' }); await flush() })
    expect(state.jobs[0]?.textContent).toBe('最新候选')
  })
})
