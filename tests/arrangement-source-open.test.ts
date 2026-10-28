import { describe, expect, it, vi } from 'vitest'
import { ArkmeService } from '../src/arkme-service.js'
import { ArrangementSourceService } from '../src/services/arrangement-source-service.js'

function fixture(evidence: Record<string, unknown>) {
  const session = { userId: 11, refreshToken: 'account-session' }
  const host = {
    runtime: {
      requireSession: vi.fn(async () => session),
      authenticatedAudioPost: vi.fn(async () => ({ audio_summary_ls: [{ id: 'summary-a' }] })),
      authenticatedPost: vi.fn(async (): Promise<Record<string, unknown>> => ({ record_core: { record_uid: 'record-a', status: 1, content_access_state: 1, origin_kind: 1 } })),
    },
    arrangement: { sourceEvidence: vi.fn(async () => evidence), sourceDocument: vi.fn(async () => 'original agent instruction') },
    source: { searchTargetSource: vi.fn(async (): Promise<unknown> => ({ ref: 'conversation-ref' })) },
    privacy: { lockedRecordUids: vi.fn(async () => new Set<string>()) },
    record: { personalRecordDetail: vi.fn(async () => ({ text: 'original' })) },
    callHistory: { arrangementCallDetail: vi.fn(async () => ({ startedAtMillis: 1791800000000, transcriptSegments: [] })) },
  }
  const open = () => ArrangementSourceService.prototype.arrangementSourceOpen.call(host as unknown as ArrangementSourceService, 'opaque-arrangement', 'evidence-id')
  return { host, open }
}

describe('arrangement source access boundary', () => {
  it('forwards the facade request and cancellation signal to the source owner', async () => {
    const target = { kind: 'document', title: '来源指令', text: 'original' }
    const arrangementSource = { arrangementSourceOpen: vi.fn(async () => target) }
    const signal = new AbortController().signal
    expect(await ArkmeService.prototype.arrangementSourceOpen.call(
      { arrangementSource } as unknown as ArkmeService, 'opaque-arrangement', 'evidence-id', signal,
    )).toBe(target)
    expect(arrangementSource.arrangementSourceOpen).toHaveBeenCalledWith('opaque-arrangement', 'evidence-id', signal)
  })
  it('rechecks summary ownership and exact version rather than choosing another version', async () => {
    const {host,open} = fixture({kind:'audio_summary',summary_id:'summary-a',date_stamp:1791734400000,tz_offset:28800000})
    expect(await open()).toMatchObject({kind:'audio_summary',summaryId:'summary-a'})
    host.runtime.authenticatedAudioPost.mockResolvedValue({audio_summary_ls:[{id:'different-version'}]})
    await expect(open()).rejects.toMatchObject({code:'arrangement-source-deleted'})
  })
  it('does not return a now private record even when a saved source ID exists', async () => {
    const {host,open} = fixture({kind:'record',record_uid:'record-a'})
    host.privacy.lockedRecordUids.mockResolvedValue(new Set(['record-a']))
    await expect(open()).rejects.toMatchObject({code:'arrangement-source-restricted'})
    expect(host.record.personalRecordDetail).not.toHaveBeenCalled()
  })
  it('uses the owned call detail and converts an absolute source time to its transcript offset', async () => {
    const {host,open} = fixture({kind:'call',room_id:'room-a',start_ms:1791800002500,text:'检查'})
    expect(await open()).toMatchObject({kind:'call',startMillis:2500,quote:'检查'})
    expect(host.callHistory.arrangementCallDetail).toHaveBeenCalledWith('room-a',undefined,{quote:'检查',startMillis:1791800002500})
  })
  it('discards a source result if the signed-in account changes during the read', async () => {
    const {host,open} = fixture({kind:'audio_summary',summary_id:'summary-a',date_stamp:1791734400000,tz_offset:28800000})
    host.runtime.requireSession.mockResolvedValueOnce({userId:11,refreshToken:'account-session'}).mockResolvedValueOnce({userId:22,refreshToken:'another-account'})
    await expect(open()).rejects.toMatchObject({code:'arrangement-source-account-changed'})
  })
  it('opens the freshly authorized agent evidence without a second document read', async () => {
    const { host, open } = fixture({ kind: 'agent', text: 'preview' })
    expect(await open()).toEqual({ kind: 'document', title: '来源指令', text: 'preview' })
    expect(host.arrangement.sourceDocument).not.toHaveBeenCalled()
    expect(host.runtime.authenticatedAudioPost).not.toHaveBeenCalled()
  })
  it('delegates an accessible personal record to its owner', async () => {
    const { host, open } = fixture({ kind: 'record', record_uid: 'record-a' })
    expect(await open()).toEqual({ kind: 'record', item: { text: 'original' } })
    expect(host.record.personalRecordDetail).toHaveBeenCalledWith('record-a', undefined)
    expect(host.source.searchTargetSource).not.toHaveBeenCalled()
  })
  it.each([3, 4])('resolves a conversation record of origin %s and fails if its source disappeared', async origin => {
    const { host, open } = fixture({ kind: 'record', record_uid: 'record-a' })
    host.runtime.authenticatedPost.mockResolvedValue({ record_core: {
      record_uid: 'record-a', status: 1, content_access_state: 1, origin_kind: origin,
      origin_container_ref: 'conversation-a', send_at: 1234,
    } })
    expect(await open()).toEqual({ kind: 'conversation', source: { ref: 'conversation-ref' }, itemUid: 'record-a', sendAtMillis: 1234 })
    expect(host.source.searchTargetSource).toHaveBeenCalledWith(3, 'conversation-a', '', undefined)
    expect(host.record.personalRecordDetail).not.toHaveBeenCalled()
    host.source.searchTargetSource.mockResolvedValue(undefined)
    await expect(open()).rejects.toMatchObject({ code: 'arrangement-source-missing' })
  })
  it.each([
    { record_uid: 'different-record', status: 1, content_access_state: 1, origin_kind: 1 },
    { record_uid: 'record-a', status: 0, content_access_state: 1, origin_kind: 1 },
    { record_uid: 'record-a', status: 1, content_access_state: 0, origin_kind: 1 },
  ])('rejects unavailable record facts before opening a target: %o', async core => {
    const { host, open } = fixture({ kind: 'record', record_uid: 'record-a' })
    host.runtime.authenticatedPost.mockResolvedValue({ record_core: core })
    await expect(open()).rejects.toMatchObject({ code: 'arrangement-source-restricted' })
    expect(host.record.personalRecordDetail).not.toHaveBeenCalled()
    expect(host.source.searchTargetSource).not.toHaveBeenCalled()
  })
})

it('opens an agent instruction from the freshly resolved evidence without reading an unvalidated document', async () => {
  const { open } = fixture({ kind: 'agent', text: '原始用户指令' })
  expect(await open()).toEqual({ kind: 'document', title: '来源指令', text: '原始用户指令' })
})
