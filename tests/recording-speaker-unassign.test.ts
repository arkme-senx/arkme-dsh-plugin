import { correctionOwnerResponse } from './fixtures/recording-correction-owner.js'
import { describe, expect, it, vi } from 'vitest'
import { RecordingService, type RecordingServiceDependencies } from '../src/services/recording-service.js'
import type { ServiceRuntime } from '../src/services/service.js'

const date = new Date(2026, 9, 13).getTime()
function fixture() {
  const session = { userId: 42, accessToken: 'test', refreshToken: 'test' }
  const rows = [
    { s: 0, e: 1000, n: 1, t: '第一句' },
    { s: 1000, e: 2000, n: 1, t: '第二句', q: '345678901234567890123456' },
    { s: 2000, e: 3000, n: 2, t: '他人', q: '456789012345678901234567' },
  ] as Array<Record<string, unknown>>
  const data = {
    session_ls: [{ id: '123456789012345678901234', belong_usr: 42, start_at: date, end_at: date + 86_400_000,
      labels: { '345678901234567890123456': '人物', '456789012345678901234567': '他人' }, spk_ls: [{ num: 1, spk_id: '345678901234567890123456' }, { num: -1, spk_id: '345678901234567890123456' }, { num: 2, spk_id: '456789012345678901234567' }] }],
    child_ls: [{ id: '234567890123456789012345', session_id: '123456789012345678901234', start_at: 0, asr: rows }],
  }
  const state = { noEffect: false, conflict: false, invalid: false, reject: false }
  const post = vi.fn(async (path: string, body: Record<string, unknown>) => {
    if (path.endsWith('/speaker/suggestion')) return {}
    if (path.includes('/recordings/')) return correctionOwnerResponse(path, body, data)
    if (path.endsWith('/get-speaker-ls')) return { spk_ls: [{ id: '345678901234567890123456', nick_name: '人物' }, { id: '456789012345678901234567', nick_name: '他人' }] }
    if (path.endsWith('/unassign-asr-item-spk')) {
      if (state.reject) throw new Error('network unavailable')
      if (state.invalid) return {}
      const indices = body.item_index_ls as number[]
      if (!state.noEffect && !state.conflict) for (const index of indices) {
        Object.assign(rows[index]!, { q: '', q_unassigned_spk_id: '345678901234567890123456', speaker_identity_source: 'system', effective_spk_id: '' })
      }
      return { modified_count: state.conflict ? 0 : indices.length, already_unassigned_count: 0, conflict_count: state.conflict ? indices.length : 0 }
    }
    return {}
  })
  const runtime = { subscribeAccountScope: () => () => {}, config: { environment: 'test', maxTextLength: 20_000 },
    requireSession: async () => session, authenticatedAudioPost: post, stateStore: { uniqueCode: async () => 'test-key' } } as unknown as ServiceRuntime
  const service = new RecordingService(runtime, {} as RecordingServiceDependencies)
  return { service, post, rows, data, state, session,
    writes: () => post.mock.calls.filter(([path]) => path.endsWith('/unassign-asr-item-spk')) }
}

describe('recording speaker removal owner contract', () => {
  it('removes only the selected inherited mark and reads back system identity', async () => {
    const f = fixture(), day = await f.service.recordingDay(date)
    const result = await f.service.unassignRecordingSpeaker({ itemRef: day.transcript.items[0]!.itemRef, scope: 'item', expectedCount: 1 })
    expect(f.writes()[0]![1]).toEqual({ child_id: '234567890123456789012345', expected_spk_id: '345678901234567890123456', item_index_ls: [0], transcript_source: 'system' })
    expect(result.warning).toBeUndefined()
    expect(result.day.transcript.items[0]!.assignedSpeakerOptionKey).toBeUndefined()
    expect(result.day.transcript.items[1]!.assignedSpeakerOptionKey).toBeDefined()
    expect(result.day.transcript.items[2]!.speakerLabel).toBe('他人')
  })

  it('bounds bulk removal to the displayed day and source, including item and inherited marks', async () => {
    const f = fixture()
    f.rows.push({ s: 86_400_001, e: 86_401_000, n: 1, t: '另一天' })
    const day = await f.service.recordingDay(date)
    expect((await f.service.recordingSpeakerRecommendation(day.transcript.items[0]!.itemRef)).groupItemCount).toBe(2)
    const result = await f.service.unassignRecordingSpeaker({ itemRef: day.transcript.items[0]!.itemRef, scope: 'speaker', expectedCount: 2 })
    expect(f.writes()).toHaveLength(1)
    expect(f.writes()[0]![1].item_index_ls).toEqual([0, 1])
    expect(f.rows[3]!.speaker_identity_source).toBeUndefined()
    expect(result.day.transcript.items.slice(0, 2).every(item => !item.assignedSpeakerOptionKey)).toBe(true)
    expect(result.day.transcript.items[2]!.assignedSpeakerOptionKey).toBeDefined()
  })

  it.each(['account', 'assignment', 'count'] as const)('rejects changed %s before writing', async change => {
    const f = fixture(), day = await f.service.recordingDay(date)
    if (change === 'account') f.session.userId = 43
    if (change === 'assignment') f.rows[0]!.q = '456789012345678901234567'
    await expect(f.service.unassignRecordingSpeaker({ itemRef: day.transcript.items[0]!.itemRef, scope: 'speaker', expectedCount: change === 'count' ? 3 : 2 })).rejects.toThrow()
    expect(f.writes()).toHaveLength(0)
  })

  it.each(['noEffect', 'conflict'] as const)('does not report full success on %s', async kind => {
    const f = fixture(), day = await f.service.recordingDay(date)
    f.state[kind] = true
    const result = await f.service.unassignRecordingSpeaker({ itemRef: day.transcript.items[0]!.itemRef, scope: 'item', expectedCount: 1 })
    expect(result.warning).toContain('未取消或已变化')
    expect(result.day.transcript.items[0]!.assignedSpeakerOptionKey).toBeDefined()
  })

  it.each(['invalid', 'reject'] as const)('does not retry a write with an unknown outcome (%s)', async kind => {
    const f = fixture(), day = await f.service.recordingDay(date)
    f.state[kind] = true
    await expect(f.service.unassignRecordingSpeaker({ itemRef: day.transcript.items[0]!.itemRef, scope: 'item', expectedCount: 1 })).rejects.toThrow()
    expect(f.writes()).toHaveLength(1)
  })
})
