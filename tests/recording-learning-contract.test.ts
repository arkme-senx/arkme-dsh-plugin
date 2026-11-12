import { describe, expect, it } from 'vitest'
import { parseRecordingLearning } from '../src/recording-learning-contract.js'

const item = (status: string, extra: object = {}) => ({ item: { start_at: 0, end_at: 5000 }, status, reason: '声音提取暂时失败', eligible: true, sample_count: 0, retryable: false, ...extra })
const raw = (items: unknown[]) => ({ schema_version: 1, correction_id: 'command', version: 'current', total_count: items.length, eligible_count: items.length, ready_count: 0, items })
describe('current learning evidence contract', () => {
  it('keeps failed extraction separate from saved assignment and seals only eligible retry jobs', async () => {
    const result = await parseRecordingLearning(raw([item('failed', { retryable: true, jobs: [{ job_id: '123456789012345678901234', attempt: 3 }] }), item('pending')]), 'command', async (id, attempt) => `${id}:${attempt}`)
    expect(result.counts).toEqual({ pending: 1, processing: 0, ready: 0, skipped: 0, failed: 1, revoked: 0 })
    expect(result.items[0]!.retryRefs).toEqual(['123456789012345678901234:3'])
    expect(result.readyCount).toBe(0)
  })
  it('never converts a commit-time claim into ready without current samples', async () => {
    await expect(parseRecordingLearning({ ...raw([item('ready')]), ready_count: 1 }, 'command', async () => '')).rejects.toThrow()
    await expect(parseRecordingLearning(raw([item('pending', { retryable: true, jobs: [] })]), 'command', async () => '')).rejects.toThrow()
    await expect(parseRecordingLearning(raw([item('pending')]), 'other-command', async () => '')).rejects.toThrow()
  })
  it('validates denominators and keeps explicit subranges', async () => {
    const value = { ...raw([item('ready', { sample_count: 2, item: { start_at: 0, end_at: 10000, selection: { start_at: 1000, end_at: 5000 } } })]), ready_count: 1 }
    expect((await parseRecordingLearning(value, 'command', async () => '')).items[0]).toMatchObject({ start: 1000, end: 5000, sampleCount: 2 })
    await expect(parseRecordingLearning({ ...value, eligible_count: 0 }, 'command', async () => '')).rejects.toThrow()
  })
})
