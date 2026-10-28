import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ArkmeRecordingWorkbenchItem } from '../src/types.js'
const mocks = vi.hoisted(() => ({ call: vi.fn(), consistency: vi.fn() }))
vi.mock('../src/client/api.js', () => ({ callArkme: (op: string, ...args: unknown[]) => op === 'recordings.speaker.consistency' ? mocks.consistency(...args) : mocks.call(op, ...args) }))
import { arkmeAuthStore } from '../src/client/auth-store.js'
import { ArkmeRecordingSpeakerReview, speakerReviewItems, speakerEvidenceBucket } from '../src/client/recordings/ArkmeRecordingSpeakerReview.js'

const item = (i: number): ArkmeRecordingWorkbenchItem => ({ itemId: `id-${i}`, itemRef: `ref-${i}`, transcriptSource: 'system', sessionKey: 'session', speakerKey: 'group', speakerNumber: 1,
  speakerLabel: '周鹏', assignedSpeakerOptionKey: 'person', speakerColorIndex: 0, sameSpeakerItemCount: 200, text: `片段 ${i}`, startAtMillis: new Date(2026, 9, 14, 12, i).getTime(), endAtMillis: new Date(2026, 9, 14, 12, i, 5).getTime(), isSelf: false, isBackground: false })
const tick = async () => { for (let i = 0; i < 12; i++) await Promise.resolve() }

describe('speaker evidence review', () => {
  let renderer: ReactTestRenderer
  const onClose = vi.fn(), onUpdated = vi.fn(), onPlay = vi.fn()
  beforeEach(() => {
    arkmeAuthStore.setAuth({ status: 'authenticated', userId: 42, environment: 'test' })
    onClose.mockReset(); onUpdated.mockReset(); onPlay.mockReset()
    mocks.consistency.mockReset().mockResolvedValue({ supported: false })
    mocks.call.mockReset().mockImplementation(async (op, input) => {
      if (op === 'recordings.speaker.evidence') return { supported: false }
      if (op === 'recordings.speaker.correction.context') return { supported: true, version: 'v1', maxItems: 100, soundSource: 'unknown', excludedSpeakers: [] }
      if (op === 'recordings.speaker.correction.apply') return { version: 'v2', affectedCount: input.itemRefs.length }
      return []
    })
  })
  afterEach(async () => { await act(async () => { renderer?.unmount(); await tick() }) })
  const mount = async (count = 3, advanced = true) => { await act(async () => { renderer = create(<ArkmeRecordingSpeakerReview item={item(0)} items={Array.from({ length: count }, (_, i) => item(i))} options={[]} onClose={onClose} onUpdated={onUpdated} onPlay={onPlay} />); await tick() }); if (advanced) await click('进一步核对 · 甲乙参照对比') }
  const buttons = (label: string) => renderer.root.findAllByType('button').filter(node => node.children.join('') === label)
  const click = async (label: string, index = 0) => { await act(async () => { buttons(label)[index]!.props.onClick(); await tick() }) }
  const choose = async (index: number) => { await act(async () => { const input = renderer.root.findAllByType('input').filter(node => String(node.props['aria-label']).startsWith('选择 '))[index]!; input.props.onChange({ target: { checked: true } }); await tick() }) }
  const writes = () => mocks.call.mock.calls.filter(([op]) => op === 'recordings.speaker.correction.apply')

  it('starts with group consistency and deviations without requiring A/B references', async () => {
    mocks.consistency.mockResolvedValue({ supported: true, groups: [{ anchorRef: 'ref-0', score: 86, state: 'partial', analyzedCount: 8, totalCount: 10, reviewCount: 2,
      version: 'v1', modelVersion: 'model', scoreDefinition: 'calibrated-v1', referenceMethod: 'robust-group',
      items: [{ itemRef: 'ref-0', deviation: .1, status: 'ready' }, { itemRef: 'ref-1', deviation: .34, status: 'ready' }, { itemRef: 'ref-2', deviation: null, status: 'insufficient' }] }] })
    await mount(3, false)
    const text = JSON.stringify(renderer.toJSON())
    expect(text).toContain('86（局部）'); expect(text).toContain('当天已分析 8 / 10 段')
    expect(buttons('作为参照甲')).toHaveLength(0)
    expect(renderer.root.findAllByType('tbody')[0]!.findAllByType('tr')[0]!.findByType('input').props['aria-label']).toContain('12:01:00')
    expect(mocks.call).not.toHaveBeenCalled()
  })

  it('requires explicit references, alternates real playback, and does not fabricate distances when unsupported', async () => {
    await mount()
    expect(buttons('对比本页声纹')[0]!.props.disabled).toBe(true)
    await click('作为参照甲', 0); await click('作为参照乙', 1)
    await click('交替试听 · 下一段甲'); await click('交替试听 · 下一段乙')
    expect(onPlay.mock.calls.map(([row]) => row.itemId)).toEqual(['id-0', 'id-1'])
    await click('对比本页声纹')
    expect(renderer.root.findByProps({ role: 'status' }).children.join('')).toContain('接口暂未开放')
    expect(mocks.call.mock.calls.find(([op]) => op === 'recordings.speaker.evidence')![1]).toMatchObject({ referenceA: ['ref-0'], referenceB: ['ref-1'] })
    expect(writes()).toHaveLength(0)
  })
  it('preserves selection across pages and submits only those intervals, including ones far from the original opener', async () => {
    await mount(55)
    await choose(1); await click('下一页'); await choose(1)
    await click('预览处理结果'); await click('确认范围，继续纠错'); await click('保存纠错')
    expect(writes()).toHaveLength(1)
    expect(writes()[0]![1]).toMatchObject({ itemRef: 'ref-1', itemRefs: ['ref-1', 'ref-51'], detach: true })
    expect(writes()[0]![1]).not.toHaveProperty('rejectCurrent')
  })
  it('protects trusted A references and keeps identity assignment preview-only', async () => {
    await mount(); await choose(0); await click('作为参照甲', 0)
    expect(buttons('预览处理结果')[0]!.props.disabled).toBe(true)
    await choose(1); await click('预览处理结果')
    await act(async () => { renderer.root.findAllByType('input').filter(node => node.props.type === 'radio')[2]!.props.onChange(); await tick() })
    expect(buttons('等待后端支持保存')[0]!.props.disabled).toBe(true)
    expect(writes()).toHaveLength(0)
  })
  it('does not display scores from a request whose references have changed', async () => {
    let resolve!: (value: unknown) => void
    mocks.call.mockImplementation((op) => op === 'recordings.speaker.evidence' ? new Promise(done => { resolve = done }) : Promise.resolve({ supported: false }))
    await mount(); await click('作为参照甲', 0); await click('对比本页声纹'); await click('作为参照甲', 1)
    await act(async () => { resolve({ supported: true, state: 'ready', version: 'v1', modelVersion: 'model', items: [] }); await tick() })
    expect(renderer.root.findByProps({ role: 'status' }).children.join('')).toContain('重新对比')
  })
  it('renders real comparative evidence and applies the review line without saving or selecting rows', async () => {
    mocks.call.mockImplementation(async (_op, input) => ({ supported: true, state: 'ready', version: 'v1', modelVersion: 'model-v1', metric: 'cosine_distance', aggregation: 'mean_reference', ambiguityMargin: .02,
      items: input.itemRefs.map((itemRef: string) => ({ itemRef, status: 'ready', distanceA: .31, distanceB: .12, effectiveSpeechMillis: 3200 })) }))
    await mount(); await click('作为参照甲', 0); await click('作为参照乙', 1); await click('对比本页声纹')
    expect(renderer.root.findAllByType('td').filter(node => node.children.join('') === '0.310')).toHaveLength(1)
    await click('较接近乙')
    expect(renderer.root.findAllByType('tbody')[0]!.findAllByType('tr')).toHaveLength(1)
    await act(async () => { renderer.root.findByProps({ 'aria-label': '审查线' }).props.onChange({ target: { value: '.25' } }); await tick() })
    expect(buttons('预览处理结果')[0]!.props.disabled).toBe(true)
    expect(mocks.call).toHaveBeenCalledOnce(); expect(writes()).toHaveLength(0)
  })
  it('shows read failures as failures, not as unsupported or zero distances', async () => {
    mocks.call.mockRejectedValue(new Error('网络暂不可用'))
    await mount(); await click('作为参照甲', 0); await click('对比本页声纹')
    expect(renderer.root.findByProps({ role: 'alert' }).children.join('')).toContain('网络暂不可用')
    expect(renderer.root.findByProps({ role: 'status' }).children.join('')).not.toContain('接口暂未开放')
    expect(buttons('重试')).toHaveLength(1); expect(writes()).toHaveLength(0)
  })
  it('closes and aborts evidence reads when the account changes', async () => {
    await mount(); await click('作为参照甲', 0)
    let signal!: AbortSignal
    mocks.call.mockImplementation((_op, _input, s) => { signal = s; return new Promise(() => {}) })
    await click('对比本页声纹')
    await act(async () => { arkmeAuthStore.setAuth({ status: 'authenticated', userId: 43, environment: 'test' }); await tick() })
    expect(signal.aborted).toBe(true); expect(onClose).toHaveBeenCalledOnce()
  })
})

it('groups by stable identity and source, not identical display labels', () => {
  expect(speakerReviewItems([item(0), { ...item(1), speakerKey: 'different' }, { ...item(2), transcriptSource: 'doubao' }], item(0)).map(row => row.itemId)).toEqual(['id-0'])
  expect(speakerEvidenceBucket({ itemRef: 'x', status: 'ready', distanceA: .3, distanceB: .29, effectiveSpeechMillis: 1000 }, .02)).toBe('ambiguous')
  expect(speakerEvidenceBucket({ itemRef: 'x', status: 'ready', distanceA: .1, distanceB: null, effectiveSpeechMillis: 1000 })).toBe('insufficient')
})
