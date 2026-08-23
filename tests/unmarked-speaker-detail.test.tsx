import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type {
  ArkmeUnmarkedSpeakerInference,
  ArkmeUnmarkedSpeakerMarkOutcome,
  ArkmeUnmarkedSpeakerOptions,
} from '../src/types.js'
import { ArkmeClientError } from '../src/client/api.js'
import {
  UnmarkedSpeakerDetail,
  type UnmarkedSpeakerDetailProps,
} from '../src/client/redesign/contacts/UnmarkedSpeakerDetail.js'

const tick = async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve() }

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((accept, decline) => { resolve = accept; reject = decline })
  return { promise, resolve, reject }
}

function instanceText(node: ReactTestInstance): string {
  return node.children.map(child => typeof child === 'string' ? child : instanceText(child)).join('')
}

function button(renderer: ReactTestRenderer, text: string): ReactTestInstance {
  const found = renderer.root.findAllByType('button').find(node => instanceText(node) === text)
  if (found === undefined) throw new Error(`button not found: ${text}`)
  return found
}

function option(
  inference: ArkmeUnmarkedSpeakerInference,
  version = 'version-7',
  candidateRef = 'candidate-a',
): ArkmeUnmarkedSpeakerOptions {
  return {
    candidateRef,
    candidateVersion: version,
    speakerToken: '13',
    appearanceDays: 3,
    validAudioDurationMillis: 66_000,
    segmentCount: 9,
    latestAtMillis: new Date(2026, 7, 23, 10, 0).getTime(),
    conversationSummaryState: 'ready',
    conversationSummary: '围绕接口联调、问题排查和上线状态进行协作。',
    inference,
    speakerChoices: [
      { speakerRef: 'speaker-recommended', displayName: '张老师', source: 'recommended' },
      { speakerRef: 'speaker-existing', displayName: '李同事', source: 'manual' },
    ],
  }
}

function baseProps(overrides: Partial<UnmarkedSpeakerDetailProps> = {}): UnmarkedSpeakerDetailProps {
  return {
    accountKey: 'account-a',
    candidateRef: 'candidate-a',
    loadOptions: vi.fn(async () => option({
      state: 'ready',
      recommendedSpeakerRef: 'speaker-recommended',
      recommendedDisplayName: '张老师',
      retryable: true,
    })),
    retryInference: vi.fn(async () => ({ candidateRef: 'candidate-a', inference: { state: 'pending' } })),
    loadSegments: vi.fn(async () => ({ items: [], total: 0, hasMore: false })),
    markSpeaker: vi.fn(async () => ({ outcome: 'marked' })),
    onDirectoryRefresh: vi.fn(),
    onCandidateCleared: vi.fn(),
    ...overrides,
  }
}

async function mount(props: UnmarkedSpeakerDetailProps): Promise<ReactTestRenderer> {
  let renderer!: ReactTestRenderer
  await act(async () => { renderer = create(<UnmarkedSpeakerDetail {...props} />); await tick() })
  return renderer
}

async function openChoice(renderer: ReactTestRenderer): Promise<void> {
  await act(async () => { button(renderer, '选择说话人').props.onClick(); await tick() })
}

function radio(renderer: ReactTestRenderer, value: string): ReactTestInstance {
  const found = renderer.root.findAllByType('input').find(node => node.props.type === 'radio' && node.props.value === value)
  if (found === undefined) throw new Error(`radio not found: ${value}`)
  return found
}

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('unmarked speaker inference summary', () => {
  it('uses the mobile identity, statistics, inference, and action-card hierarchy', async () => {
    const renderer = await mount(baseProps())
    const markup = renderer.toJSON()
    const text = instanceText(renderer.root)

    expect(renderer.root.findByProps({ className: 'arkme-unmarked-speaker-token-avatar' })).toBeDefined()
    expect(text).toContain('说话人 13')
    expect(text).toContain('最近：')
    expect(text).toContain('出现 3 天')
    expect(text).toContain('有效声音 1 分 6 秒')
    expect(text).toContain('相关片段 9 个')
    expect(text).toContain('围绕接口联调、问题排查和上线状态进行协作。')
    expect(renderer.root.findAllByProps({ className: 'arkme-unmarked-speaker-action' })).toHaveLength(2)
    expect(JSON.stringify(markup)).toContain('M3 8.25V15.75')
    expect(JSON.stringify(markup)).toContain('M12.1601 10.87')
    await act(async () => { renderer.unmount() })
  })

  it.each([
    [{ state: 'ready', recommendedDisplayName: '张老师', recommendedSpeakerRef: 'speaker-recommended' }, '张老师'],
    [{ state: 'pending' }, '正在推测'],
    [{ state: 'failed', retryable: true }, '推测失败'],
    [{ state: 'failed', retryable: false }, '推测失败'],
    [{ state: 'unavailable' }, '暂不可用'],
  ] as const)('shows 推测说话人 and keeps listening/manual choice independent for %s', async (inference, visible) => {
    const renderer = await mount(baseProps({ loadOptions: async () => option(inference) }))

    const text = instanceText(renderer.root)
    expect(text).toContain('推测说话人')
    expect(text).toContain(visible)
    expect(button(renderer, '去听声音').props.disabled).not.toBe(true)
    expect(button(renderer, '选择说话人').props.disabled).not.toBe(true)
    await act(async () => { renderer.unmount() })
  })

  it('uses explicit audio/choice subviews with visible back actions', async () => {
    const renderer = await mount(baseProps())

    await act(async () => { button(renderer, '去听声音').props.onClick(); await tick() })
    expect(instanceText(renderer.root)).toContain('声音片段')
    await act(async () => { button(renderer, '返回候选摘要').props.onClick(); await tick() })
    expect(instanceText(renderer.root)).toContain('推测说话人')

    await openChoice(renderer)
    expect(instanceText(renderer.root)).toContain('标记为说话人')
    await act(async () => { button(renderer, '返回候选摘要').props.onClick(); await tick() })
    expect(instanceText(renderer.root)).toContain('推测说话人')
    await act(async () => { renderer.unmount() })
  })

  it('keeps the last-known inference visible while a safe retry is pending', async () => {
    const retry = deferred<{ candidateRef: string; inference: ArkmeUnmarkedSpeakerInference }>()
    const renderer = await mount(baseProps({ retryInference: () => retry.promise }))

    await act(async () => { button(renderer, '重新推测').props.onClick(); await tick() })
    expect(instanceText(renderer.root)).toContain('张老师')
    expect(button(renderer, '正在重新推测…').props.disabled).toBe(true)
    await act(async () => { retry.resolve({ candidateRef: 'candidate-a', inference: { state: 'pending' } }); await tick() })
    expect(instanceText(renderer.root)).toContain('张老师')
    await act(async () => { renderer.unmount() })
  })

  it('keeps the last-known inference when a retryable retry completes as failed', async () => {
    const renderer = await mount(baseProps({
      retryInference: async () => ({ candidateRef: 'candidate-a', inference: { state: 'failed', retryable: true } }),
    }))

    await act(async () => { button(renderer, '重新推测').props.onClick(); await tick() })
    expect(instanceText(renderer.root)).toContain('张老师')
    expect(instanceText(renderer.root)).toContain('推测失败')
    expect(button(renderer, '重新推测')).toBeDefined()
    await act(async () => { renderer.unmount() })
  })

  it('clears the last-known recommendation when a completed inference reports no recommendation', async () => {
    vi.useFakeTimers()
    const loadOptions = vi.fn()
      .mockResolvedValueOnce(option({
        state: 'pending', recommendedSpeakerRef: 'speaker-recommended', recommendedDisplayName: '张老师',
      }))
      .mockResolvedValueOnce(option({ state: 'ready' }))
    const renderer = await mount(baseProps({ loadOptions }))
    expect(instanceText(renderer.root)).toContain('张老师')

    await act(async () => { await vi.advanceTimersByTimeAsync(2_000); await tick() })
    expect(instanceText(renderer.root)).toContain('未找到明确推荐')
    expect(instanceText(renderer.root)).not.toContain('张老师')
    await act(async () => { renderer.unmount() })
  })

  it('polls pending inference at 2s ×5, 5s ×6, then 10s', async () => {
    vi.useFakeTimers()
    const loadOptions = vi.fn(async () => option({ state: 'pending' }))
    const renderer = await mount(baseProps({ loadOptions }))
    expect(loadOptions).toHaveBeenCalledTimes(1)

    for (let index = 0; index < 5; index += 1) {
      await act(async () => { await vi.advanceTimersByTimeAsync(2_000); await tick() })
    }
    expect(loadOptions).toHaveBeenCalledTimes(6)
    for (let index = 0; index < 6; index += 1) {
      await act(async () => { await vi.advanceTimersByTimeAsync(5_000); await tick() })
    }
    expect(loadOptions).toHaveBeenCalledTimes(12)
    await act(async () => { await vi.advanceTimersByTimeAsync(9_999); await tick() })
    expect(loadOptions).toHaveBeenCalledTimes(12)
    await act(async () => { await vi.advanceTimersByTimeAsync(1); await tick() })
    expect(loadOptions).toHaveBeenCalledTimes(13)
    await act(async () => { renderer.unmount() })
  })

  it('clamps server retryAfterMillis to 1–30 seconds in the mounted poll effect', async () => {
    vi.useFakeTimers()
    const loadOptions = vi.fn()
      .mockResolvedValueOnce({ ...option({ state: 'pending' }), retryAfterMillis: 0 })
      .mockResolvedValueOnce({ ...option({ state: 'pending' }), retryAfterMillis: 60_000 })
      .mockResolvedValueOnce(option({ state: 'ready' }))
    const renderer = await mount(baseProps({ loadOptions }))

    await act(async () => { await vi.advanceTimersByTimeAsync(999); await tick() })
    expect(loadOptions).toHaveBeenCalledOnce()
    await act(async () => { await vi.advanceTimersByTimeAsync(1); await tick() })
    expect(loadOptions).toHaveBeenCalledTimes(2)
    await act(async () => { await vi.advanceTimersByTimeAsync(29_999); await tick() })
    expect(loadOptions).toHaveBeenCalledTimes(2)
    await act(async () => { await vi.advanceTimersByTimeAsync(1); await tick() })
    expect(loadOptions).toHaveBeenCalledTimes(3)
    await act(async () => { renderer.unmount() })
  })

  it('cancels pending polls on candidate/account change and unmount', async () => {
    vi.useFakeTimers()
    const loadOptions = vi.fn(async () => option({ state: 'pending' }))
    const props = baseProps({ loadOptions })
    const renderer = await mount(props)

    await act(async () => {
      renderer.update(<UnmarkedSpeakerDetail {...props} candidateRef="candidate-b" />)
      await tick()
    })
    expect(loadOptions.mock.calls.map(call => call[0])).toEqual(['candidate-a', 'candidate-b'])
    await act(async () => { await vi.advanceTimersByTimeAsync(2_000); await tick() })
    expect(loadOptions.mock.calls.map(call => call[0])).toEqual(['candidate-a', 'candidate-b', 'candidate-b'])

    await act(async () => {
      renderer.update(<UnmarkedSpeakerDetail {...props} accountKey="account-b" candidateRef="candidate-b" />)
      await tick()
    })
    expect(loadOptions).toHaveBeenCalledTimes(4)
    await act(async () => { renderer.unmount(); await vi.advanceTimersByTimeAsync(30_000) })
    expect(loadOptions).toHaveBeenCalledTimes(4)
  })

  it('never renders A options or choice state in the first B identity render', async () => {
    const bOptions = deferred<ArkmeUnmarkedSpeakerOptions>()
    const loadOptions = vi.fn(async (candidateRef: string) => candidateRef === 'candidate-a'
      ? option({ state: 'ready', recommendedDisplayName: '张老师' })
      : await bOptions.promise)
    const props = baseProps({ loadOptions })
    const renderer = await mount(props)
    await openChoice(renderer)
    await act(async () => { radio(renderer, 'speaker-existing').props.onChange(); await tick() })

    renderer.update(<UnmarkedSpeakerDetail {...props} candidateRef="candidate-b" />)
    expect(instanceText(renderer.root)).not.toContain('张老师')
    expect(instanceText(renderer.root)).not.toContain('李同事')
    await act(async () => { await tick() })
    await act(async () => {
      bOptions.resolve({
        ...option({ state: 'ready' }, 'version-b', 'candidate-b'),
        appearanceDays: 8,
        segmentCount: 12,
        speakerChoices: [{ speakerRef: 'speaker-b', displayName: '王同事', source: 'manual' }],
      })
      await tick()
    })
    await openChoice(renderer)
    expect(instanceText(renderer.root)).toContain('王同事')
    expect(radio(renderer, 'speaker-b').props.checked).toBe(false)
    await act(async () => { renderer.unmount() })
  })

  it('aborts the initial options request on identity change and unmount', async () => {
    const requests: Array<{ candidateRef: string; signal: AbortSignal }> = []
    const loadOptions = vi.fn((candidateRef: string, signal: AbortSignal) => {
      requests.push({ candidateRef, signal })
      return new Promise<ArkmeUnmarkedSpeakerOptions>(() => undefined)
    })
    const props = baseProps({ loadOptions })
    const renderer = await mount(props)

    await act(async () => { renderer.update(<UnmarkedSpeakerDetail {...props} candidateRef="candidate-b" />); await tick() })
    expect(requests[0]?.signal.aborted).toBe(true)
    expect(requests[1]?.candidateRef).toBe('candidate-b')
    await act(async () => { renderer.unmount() })
    expect(requests[1]?.signal.aborted).toBe(true)
  })

  it('clears and refreshes when options loading reports candidate_not_found', async () => {
    const props = baseProps({
      loadOptions: async () => { throw new ArkmeClientError({
        code: 'unmarked-candidate-not-found', message: '候选不存在', retryable: false,
      }) },
    })
    const renderer = await mount(props)

    expect(instanceText(renderer.root)).toContain('候选已不存在')
    expect(props.onCandidateCleared).toHaveBeenCalledOnce()
    expect(props.onDirectoryRefresh).toHaveBeenCalledOnce()
    expect(() => button(renderer, '去听声音')).toThrow()
    await act(async () => { renderer.unmount() })
  })
})

describe('speaker choice and marking', () => {
  it('supports recommended, existing, and bounded nonblank new-name modes with exactly one mode', async () => {
    const props = baseProps()
    const renderer = await mount(props)
    await openChoice(renderer)
    expect(instanceText(renderer.root)).toContain('3 天')
    expect(instanceText(renderer.root)).toContain('相关片段 9 个')
    expect(renderer.root.findAllByType('fieldset')).toHaveLength(1)
    expect(renderer.root.findAllByType('legend').map(instanceText)).toContain('选择说话人')
    expect(renderer.root.findByProps({ className: 'arkme-unmarked-speaker-subview-header' })).toBeDefined()
    expect(renderer.root.findAllByProps({ className: 'arkme-unmarked-speaker-choice-option' })).toHaveLength(3)
    expect(renderer.root.findByProps({ className: 'arkme-unmarked-speaker-recommended' })).toBeDefined()
    expect(button(renderer, '确认标记全部片段').props.className).toContain('arkme-unmarked-speaker-confirm')
    expect(button(renderer, '确认标记全部片段').props.disabled).toBe(true)

    await act(async () => { radio(renderer, 'speaker-recommended').props.onChange(); await tick() })
    expect(button(renderer, '确认标记全部片段').props.disabled).toBe(false)
    await act(async () => { radio(renderer, 'speaker-existing').props.onChange(); await tick() })

    const newMode = radio(renderer, '__new__')
    await act(async () => { newMode.props.onChange(); await tick() })
    const input = renderer.root.findByProps({ 'aria-label': '新说话人名称' })
    expect(input.props.placeholder).toBe('请输入说话人名称')
    await act(async () => { input.props.onChange({ currentTarget: { value: '   ' } }); await tick() })
    expect(button(renderer, '确认标记全部片段').props.disabled).toBe(true)
    expect(input.props.maxLength).toBe(100)
    await act(async () => { input.props.onChange({ currentTarget: { value: ' 新同事 ' } }); await tick() })
    expect(button(renderer, '确认标记全部片段').props.disabled).toBe(false)

    await act(async () => { button(renderer, '确认标记全部片段').props.onClick(); await tick() })
    expect(props.markSpeaker).toHaveBeenCalledWith({
      candidateRef: 'candidate-a', candidateVersion: 'version-7', newSpeakerName: '新同事',
    }, expect.any(AbortSignal))
    expect(instanceText(renderer.root)).toContain('标记成功')
    expect(props.onDirectoryRefresh).toHaveBeenCalledOnce()
    await act(async () => { renderer.unmount() })
  })

  it('forwards the current version and disables duplicate existing-speaker submits', async () => {
    const result = deferred<{ outcome: 'marked' }>()
    const markSpeaker = vi.fn(() => result.promise)
    const renderer = await mount(baseProps({ markSpeaker }))
    await openChoice(renderer)
    await act(async () => { radio(renderer, 'speaker-recommended').props.onChange(); await tick() })

    await act(async () => {
      button(renderer, '确认标记全部片段').props.onClick()
      button(renderer, '确认标记全部片段').props.onClick()
      await tick()
    })
    expect(markSpeaker).toHaveBeenCalledOnce()
    expect(markSpeaker).toHaveBeenCalledWith({
      candidateRef: 'candidate-a', candidateVersion: 'version-7', speakerRef: 'speaker-recommended',
    }, expect.any(AbortSignal))
    expect(button(renderer, '正在标记…').props.disabled).toBe(true)
    await act(async () => { result.resolve({ outcome: 'marked' }); await tick() })
    await act(async () => { renderer.unmount() })
  })

  it.each([
    ['stale', true, false, '候选版本已过期'],
    ['conflict', true, false, '部分片段已被其他操作标记'],
    ['candidate_not_found', false, true, '候选已不存在'],
    ['speaker_not_found', true, false, '说话人已不存在'],
  ] as const)('recovers from %s without optimistically deleting another candidate', async (
    outcome: Exclude<ArkmeUnmarkedSpeakerMarkOutcome, 'marked'>,
    staysInChoice,
    clearsCandidate,
    visible,
  ) => {
    const recovery = deferred<ArkmeUnmarkedSpeakerOptions>()
    const loadOptions = vi.fn()
      .mockResolvedValueOnce(option({ state: 'ready' }))
      .mockImplementationOnce(() => recovery.promise)
    const props = baseProps({
      loadOptions,
      markSpeaker: vi.fn(async () => ({ outcome })),
    })
    const renderer = await mount(props)
    await openChoice(renderer)
    await act(async () => { radio(renderer, 'speaker-existing').props.onChange(); await tick() })
    await act(async () => { button(renderer, '确认标记全部片段').props.onClick(); await tick() })

    expect(instanceText(renderer.root)).toContain(visible)
    expect(props.onCandidateCleared).toHaveBeenCalledTimes(clearsCandidate ? 1 : 0)
    expect(props.onDirectoryRefresh).toHaveBeenCalledTimes(clearsCandidate ? 1 : 0)
    if (staysInChoice) {
      expect(instanceText(renderer.root)).toContain('标记为说话人')
      expect(loadOptions).toHaveBeenCalledTimes(2)
      await act(async () => { recovery.resolve(option({ state: 'ready' }, 'version-8')); await tick() })
      expect(instanceText(renderer.root)).not.toContain(visible)
    }
    await act(async () => { renderer.unmount() })
  })

  it('blocks stale payload reuse until recovery installs new options and clears the old selection/error', async () => {
    const refreshed = deferred<ArkmeUnmarkedSpeakerOptions>()
    const loadOptions = vi.fn()
      .mockResolvedValueOnce(option({ state: 'ready' }, 'version-7'))
      .mockImplementationOnce(() => refreshed.promise)
    const markSpeaker = vi.fn()
      .mockResolvedValueOnce({ outcome: 'stale' })
      .mockResolvedValueOnce({ outcome: 'marked' })
    const renderer = await mount(baseProps({ loadOptions, markSpeaker }))
    await openChoice(renderer)
    await act(async () => { radio(renderer, 'speaker-existing').props.onChange(); await tick() })
    await act(async () => { button(renderer, '确认标记全部片段').props.onClick(); await tick() })

    expect(button(renderer, '正在刷新选项…').props.disabled).toBe(true)
    expect(markSpeaker).toHaveBeenCalledOnce()
    await act(async () => { button(renderer, '正在刷新选项…').props.onClick(); await tick() })
    expect(markSpeaker).toHaveBeenCalledOnce()

    await act(async () => {
      refreshed.resolve({
        ...option({ state: 'ready' }, 'version-8'),
        speakerChoices: [{ speakerRef: 'speaker-new', displayName: '新选项', source: 'manual' }],
      })
      await tick()
    })
    expect(instanceText(renderer.root)).not.toContain('候选版本已过期')
    expect(button(renderer, '确认标记全部片段').props.disabled).toBe(true)
    await act(async () => { radio(renderer, 'speaker-new').props.onChange(); await tick() })
    await act(async () => { button(renderer, '确认标记全部片段').props.onClick(); await tick() })
    expect(markSpeaker).toHaveBeenLastCalledWith({
      candidateRef: 'candidate-a', candidateVersion: 'version-8', speakerRef: 'speaker-new',
    }, expect.any(AbortSignal))
    await act(async () => { renderer.unmount() })
  })
})
