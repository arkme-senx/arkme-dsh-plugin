import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
const calls = vi.hoisted(() => vi.fn())
vi.mock('../src/client/api.js', () => ({ callArkme: calls }))
import { RecordingLearningStatus } from '../src/client/recordings/RecordingLearningStatus.js'
const state = (status: 'pending' | 'failed' | 'ready') => ({ version: status, totalCount: 1, eligibleCount: 1, readyCount: status === 'ready' ? 1 : 0,
  counts: { pending: 0, processing: 0, ready: 0, skipped: 0, failed: 0, revoked: 0, [status]: 1 },
  items: [{ status, reason: '声音提取暂时失败', eligible: true, sampleCount: status === 'ready' ? 1 : 0, start: 0, end: 5000, retryRefs: status === 'failed' ? ['opaque-retry'] : [] }] })
let renderer: ReactTestRenderer | undefined
const settle = async () => { for (let i = 0; i < 5; i++) await Promise.resolve() }
afterEach(async () => { await act(async () => { renderer?.unmount() }); renderer = undefined; vi.useRealTimers(); calls.mockReset() })
describe('learning status at the existing correction result', () => {
  it('refreshes pending state and aborts polling when closed', async () => {
    vi.useFakeTimers(); calls.mockResolvedValueOnce(state('pending')).mockResolvedValueOnce(state('ready'))
    await act(async () => { renderer = create(<RecordingLearningStatus learningRef="saved-command"/>); await settle() })
    expect(calls).toHaveBeenCalledTimes(1)
    await act(async () => { await vi.advanceTimersByTimeAsync(5000) })
    expect(calls).toHaveBeenCalledTimes(2)
    await act(async () => { renderer!.unmount(); await vi.advanceTimersByTimeAsync(10000) })
    expect((calls.mock.calls[0]![2] as AbortSignal).aborted).toBe(true)
    expect(calls).toHaveBeenCalledTimes(2)
  })
  it('keeps failed learning visible without offering task writes, and rereads only on read failure', async () => {
    calls.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(state('failed'))
    await act(async () => { renderer = create(<RecordingLearningStatus learningRef="saved-command"/>); await settle() })
    const click = async (name: string) => { await act(async () => { renderer!.root.findAllByType('button').find(b => b.children.join('') === name)!.props.onClick(); await settle() }) }
    await click('重新读取状态')
    expect(JSON.stringify(renderer!.toJSON())).toContain('部分未生效')
    expect(JSON.stringify(renderer!.toJSON())).not.toContain('重试失败任务')
    await click('查看详情')
    expect(JSON.stringify(renderer!.toJSON())).toContain('处理失败')
    expect(calls.mock.calls.map(c => c[0])).toEqual(['recordings.speaker.correction.learning', 'recordings.speaker.correction.learning'])
  })
})
