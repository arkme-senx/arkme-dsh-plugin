import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { person } from './helpers/speaker-directory.js'
import type { SpeakerSimilarityResult } from '../src/speaker-similarity-contract.js'
const mocks = vi.hoisted(() => ({ call: vi.fn(), toggle: vi.fn(), stop: vi.fn() }))
vi.mock('../src/client/api.js', () => ({ callArkme: mocks.call }))
vi.mock('../src/client/redesign/contacts/useSingleAudioPlayback.js', () => ({ useSingleAudioPlayback: () => ({ toggle: mocks.toggle, stop: mocks.stop, errors: {} }) }))
import { SimilarSpeakersPanel } from '../src/client/recordings/SimilarSpeakersPanel.js'
const group = { state: 'ready' as const, score: 93, analyzedCount: 10, totalCount: 10, reviewCount: 0 }
const result = (id = 'b'): SpeakerSimilarityResult => ({ supported: true, state: 'ready', version: 'v1', modelVersion: 'model', scoreDefinition: 'cohesion', aggregation: 'robust', anchor: person('a'), anchorConsistency: group, searchedCount: 100, totalCount: 1000,
  items: [{ person: person(id), distance: .12, consistency: group, reason: '合成测试证据' }], hasMore: false, nextCursor: '' })
const tick = async () => { for (let i = 0; i < 12; i++) await Promise.resolve() }
describe('similar speaker review UI', () => {
  let renderer: ReactTestRenderer
  const mount = async () => { await act(async () => { renderer = create(<SimilarSpeakersPanel accountKey="prod:7" row={person('a')} onBack={() => {}} />); await tick() }) }
  const button = (label: string) => renderer.root.findAllByType('button').find(node => node.children.join('') === label)!
  const click = async (label: string) => { await act(async () => { button(label).props.onClick(); await tick() }) }
  const select = async () => { await act(async () => renderer.root.findByProps({ 'aria-label': '选择 说话人 b' }).props.onChange({ target: { checked: true } })) }
  beforeEach(() => { mocks.call.mockReset().mockResolvedValue(result()); mocks.toggle.mockReset(); mocks.stop.mockReset() })
  afterEach(async () => { await act(async () => { renderer?.unmount(); await tick() }) })
  it('defaults to unselected candidates and separates distance from consistency', async () => {
    await mount()
    expect(renderer.root.findByProps({ 'aria-label': '选择 说话人 b' }).props.checked).toBe(false)
    expect(JSON.stringify(renderer.toJSON())).toContain('0.120')
    expect(JSON.stringify(renderer.toJSON())).toContain('已检索 100 / 1000 个分组')
    expect(button('预览统一标记').props.disabled).toBe(true)
    expect(mocks.call).toHaveBeenCalledTimes(1)
  })
  it('previews only selected scope, keeps anonymous identity possible, and never saves', async () => {
    await mount(); await select(); await click('预览统一标记')
    const radios = renderer.root.findAllByType('input').filter(node => node.props.type === 'radio')
    await act(async () => radios[2]!.props.onChange())
    expect(JSON.stringify(renderer.toJSON())).toContain('保留一个匿名身份')
    expect(button('等待后端支持保存').props.disabled).toBe(true)
    await click('返回核对')
    expect(renderer.root.findByProps({ 'aria-label': '选择 说话人 b' }).props.checked).toBe(true)
    await click('不是同一个人')
    expect(JSON.stringify(renderer.toJSON())).toContain('候选之间的关系保持不变')
    expect(mocks.call.mock.calls.every(([op]) => op === 'speaker-directory.similar')).toBe(true)
  })
  it('compares real media handles and alternates the anchor and candidate without mutation', async () => {
    mocks.call.mockImplementation(async (op, input) => op === 'speaker-directory.similar' ? result() : { supported: true, items: [{ sampleKey: input.detailRef, timeLabel: '10月14日', durationMillis: 4000, transcript: '试听样本', mediaRef: `media:${input.detailRef}` }] })
    await mount(); await click('比较片段'); await click('交替试听 · 下一段基准'); await click('交替试听 · 下一段候选')
    expect(mocks.toggle.mock.calls).toEqual([[person('a').detailRef, `media:${person('a').detailRef}`], [person('b').detailRef, `media:${person('b').detailRef}`]])
    expect(mocks.call.mock.calls.filter(([op]) => op === 'speaker-directory.voice-samples')).toHaveLength(2)
  })
  it('shows capability absence instead of inventing neighbours, while allowing anchor playback', async () => {
    mocks.call.mockResolvedValue({ supported: false }); await mount()
    expect(JSON.stringify(renderer.toJSON())).toContain('相似声音检索暂未开放')
    expect(renderer.root.findAllByType('input')).toHaveLength(0)
    expect(button('试听 / 查看片段')).toBeTruthy()
  })
  it('keeps cross-page selection but invalidates it when evidence changes', async () => {
    const first = result(); if (!first.supported) throw Error()
    mocks.call.mockResolvedValueOnce({ ...first, hasMore: true, nextCursor: 'page2' }).mockResolvedValueOnce(result('c'))
    await mount(); await select(); await click('查看更多相似声音')
    expect(renderer.root.findByProps({ 'aria-label': '选择 说话人 b' }).props.checked).toBe(true)
    expect(mocks.call.mock.calls[1]![1]).toMatchObject({ cursor: 'page2', version: 'v1' })
    await click('重新查找')
    expect(button('预览统一标记').props.disabled).toBe(true)
  })
  it('discards a late result after account switch', async () => {
    let finish!: (value: unknown) => void
    mocks.call.mockImplementationOnce(() => new Promise(resolve => { finish = resolve })).mockResolvedValue({ supported: false })
    await mount(); const oldSignal = mocks.call.mock.calls[0]![2]
    await act(async () => { renderer.update(<SimilarSpeakersPanel accountKey="prod:8" row={person('other')} onBack={() => {}} />); await tick() })
    await act(async () => { finish(result()); await tick() })
    expect(oldSignal.aborted).toBe(true)
    expect(JSON.stringify(renderer.toJSON())).not.toContain('合成测试证据')
  })
})
