import { describe, expect, it, vi } from 'vitest'
import { ArkmeService } from '../src/arkme-service.js'

function fixture(evidence: Record<string, unknown>) {
  const session = { userId: 11, refreshToken: 'account-session' }
  const host = {
    runtime: {
      requireSession: vi.fn(async () => session),
      authenticatedAudioPost: vi.fn(async () => ({ audio_summary_ls: [{ id: 'summary-a' }] })),
      authenticatedPost: vi.fn(async () => ({ record_core: { record_uid: 'record-a', status: 1, content_access_state: 1, origin_kind: 1 } })),
    },
    arrangement: { sourceEvidence: vi.fn(async () => evidence) },
    privacy: { lockedRecordUids: vi.fn(async () => new Set<string>()) },
    record: { personalRecordDetail: vi.fn(async () => ({ text: 'original' })) },
    callHistory: { arrangementCallDetail: vi.fn(async () => ({ startedAtMillis: 1791800000000, transcriptSegments: [] })) },
  }
  const open = () => ArkmeService.prototype.arrangementSourceOpen.call(host as unknown as ArkmeService, 'opaque-arrangement', 'evidence-id')
  return { host, open }
}

describe('arrangement source access boundary', () => {
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
})
