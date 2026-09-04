import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ callArkme: vi.fn() }))
vi.mock('../src/client/api.js', async importOriginal => ({
  ...await importOriginal<typeof import('../src/client/api.js')>(),
  callArkme: mocks.callArkme,
}))

import { ArkmeRecordingSurface } from '../src/client/ArkmeRecordingSurface.js'

const tick = async () => { await Promise.resolve(); await Promise.resolve() }

function renderedText(node: ReactTestInstance): string {
  return node.children.map(child => typeof child === 'string' ? child : renderedText(child)).join('')
}

function button(renderer: ReactTestRenderer, label: string): ReactTestInstance {
  const matches = renderer.root.findAll(node => node.type === 'button' && renderedText(node) === label)
  expect(matches).toHaveLength(1)
  return matches[0]!
}

describe('recording summary and timeline generation', () => {
  let renderer: ReactTestRenderer

  beforeEach(() => {
    mocks.callArkme.mockReset().mockImplementation(async (operation, params) => {
      if (operation === 'recordings.calendar') return { fromStamp: 0, toStamp: 1, days: [] }
      if (operation === 'recordings.summary-model-config') return {
        defaultRouteKey: 'dashscope/qwen3-max', effectiveRouteKey: 'dashscope/qwen3-max',
        options: [
          { routeKey: 'dashscope/qwen3-max', provider: 'dashscope', modelKey: 'qwen3-max', displayName: 'Qwen3 Max' },
          { routeKey: 'dashscope/glm-5', provider: 'dashscope', modelKey: 'glm-5', displayName: 'GLM-5' },
        ],
      }
      if (operation === 'recordings.summary-model-config.set') return { effectiveRouteKey: String(params?.routeKey) }
      if (operation === 'recordings.day') return {
        dateStamp: Number(params?.dateStamp), totalDurationMillis: 5_000,
        transcript: {
          state: 'ready', message: '', totalDurationMillis: 5_000, processingCount: 0,
          items: [{
            itemId: 'item-1', itemRef: 'opaque-item', startAtMillis: Number(params?.dateStamp) + 1_000,
            endAtMillis: Number(params?.dateStamp) + 6_000, speakerNumber: 1, speakerKey: 'opaque-speaker',
            speakerColorIndex: 0, speakerLabel: '我', sameSpeakerItemCount: 1, isSelf: true,
            isBackground: false, text: '今天完成了方案评审',
          }],
        },
        summary: { state: 'empty', message: '暂无已生成内容', items: [] },
        timeline: { state: 'empty', message: '暂无已生成内容', items: [] },
      }
      if (operation === 'recordings.generate') {
        return { state: 'processing', message: '内容仍在生成', items: [] }
      }
      throw new Error(`unexpected operation: ${String(operation)}`)
    })
  })

  afterEach(async () => {
    await act(async () => { renderer?.unmount(); await tick() })
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('continues owner polling beyond the fast budget until the owner exposes a retryable state', async () => {
    vi.useFakeTimers()
    const originalImplementation = mocks.callArkme.getMockImplementation()!
    let dayReads = 0
    mocks.callArkme.mockImplementation(async (operation, params, signal) => {
      if (operation === 'recordings.day') {
        dayReads += 1
        const day = await originalImplementation(operation, params, signal)
        return {
          ...day,
          summary: dayReads <= 91
            ? { state: 'processing', message: '内容仍在生成', items: [] }
            : { state: 'failed', message: '生成失败，请重试', items: [] },
        }
      }
      return await originalImplementation(operation, params, signal)
    })
    await act(async () => {
      renderer = create(<ArkmeRecordingSurface onOpenRecordingImport={() => {}} recordingRefreshRevision={0} />)
      await tick()
    })
    await act(async () => { button(renderer, '总结').props.onClick(); await tick() })

    await act(async () => {
      await vi.advanceTimersByTimeAsync(300_000)
      await tick()
    })

    expect(dayReads).toBeGreaterThan(91)
    expect(renderedText(renderer.root)).toContain('总结生成失败，')
    expect(button(renderer, '点击生成总结')).toBeDefined()
  })

  it('preserves the selected timeline version while polling an independent summary generation', async () => {
    vi.useFakeTimers()
    const originalImplementation = mocks.callArkme.getMockImplementation()!
    mocks.callArkme.mockImplementation(async (operation, params, signal) => {
      if (operation === 'recordings.day') {
        const day = await originalImplementation(operation, params, signal)
        return {
          ...day,
          summary: { state: 'processing', message: '内容仍在生成', items: [] },
          timeline: {
            state: 'ready', message: '', items: [
              {
                id: 'timeline-new', status: 'done', selectable: true, generationStage: 2,
                generatedAtMillis: 2_000, modelDisplayName: 'Qwen3 Max', content: '最新时间轴',
                timelineEvents: [{ eventId: 'new', timeRange: '10:00', title: '最新时间轴', description: '', todo: '', scene: '', emotion: '', participants: [], tags: [] }],
                error: '',
              },
              {
                id: 'timeline-old', status: 'done', selectable: true, generationStage: 2,
                generatedAtMillis: 1_000, modelDisplayName: 'Qwen3 Max', content: '历史时间轴',
                timelineEvents: [{ eventId: 'old', timeRange: '09:00', title: '历史时间轴', description: '', todo: '', scene: '', emotion: '', participants: [], tags: [] }],
                error: '',
              },
            ],
          },
        }
      }
      return await originalImplementation(operation, params, signal)
    })
    await act(async () => {
      renderer = create(<ArkmeRecordingSurface onOpenRecordingImport={() => {}} recordingRefreshRevision={0} />)
      await tick()
    })
    await act(async () => { button(renderer, '时间轴').props.onClick(); await tick() })
    const picker = renderer.root.findByProps({ 'aria-label': '切换时间轴版本' })
    await act(async () => {
      picker.props.onClick({ currentTarget: { getBoundingClientRect: () => ({ left: 100, right: 420, top: 100, bottom: 136 }) } })
      await tick()
    })
    const options = renderer.root.findByProps({ 'aria-label': '切换时间轴版本选项' })
    await act(async () => {
      options.findAllByProps({ role: 'option' })[1]!.props.onClick()
      await tick()
    })
    expect(renderedText(renderer.root)).toContain('历史时间轴')

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_500)
      await tick()
    })

    expect(renderedText(renderer.root)).toContain('历史时间轴')
    expect(renderedText(renderer.root)).not.toContain('最新时间轴')
  })

  it('starts each owner generation from the matching desktop empty action', async () => {
    await act(async () => {
      renderer = create(<ArkmeRecordingSurface onOpenRecordingImport={() => {}} recordingRefreshRevision={0} />)
      await tick()
    })

    await act(async () => { button(renderer, '总结').props.onClick(); await tick() })
    await act(async () => { button(renderer, '点击生成总结').props.onClick(); await tick() })

    expect(mocks.callArkme).toHaveBeenCalledWith('recordings.generate', {
      dateStamp: expect.any(Number), kind: 'summary',
    }, expect.any(AbortSignal))
    expect(renderedText(renderer.root)).toContain('生成总结中...')
    expect(renderer.root.findAll(node => node.type === 'button' && renderedText(node) === '点击生成总结')).toHaveLength(0)

    await act(async () => { button(renderer, '时间轴').props.onClick(); await tick() })
    await act(async () => { button(renderer, '点击生成时间轴').props.onClick(); await tick() })

    expect(mocks.callArkme).toHaveBeenCalledWith('recordings.generate', {
      dateStamp: expect.any(Number), kind: 'timeline',
    }, expect.any(AbortSignal))
    expect(renderedText(renderer.root)).toContain('生成时间轴中...')
  })

  it('does not block timeline generation while a summary request is still being accepted', async () => {
    let finishSummary: ((value: unknown) => void) | undefined
    const summaryResponse = new Promise(resolve => { finishSummary = resolve })
    const originalImplementation = mocks.callArkme.getMockImplementation()!
    mocks.callArkme.mockImplementation(async (operation, params, signal) => {
      if (operation === 'recordings.generate' && params?.kind === 'summary') return await summaryResponse
      return await originalImplementation(operation, params, signal)
    })
    await act(async () => {
      renderer = create(<ArkmeRecordingSurface onOpenRecordingImport={() => {}} recordingRefreshRevision={0} />)
      await tick()
    })

    await act(async () => { button(renderer, '总结').props.onClick(); await tick() })
    const generateSummary = button(renderer, '点击生成总结')
    await act(async () => {
      generateSummary.props.onClick()
      generateSummary.props.onClick()
      await tick()
    })
    expect(mocks.callArkme.mock.calls.filter(([operation, params]) => (
      operation === 'recordings.generate' && params?.kind === 'summary'
    ))).toHaveLength(1)
    await act(async () => { button(renderer, '时间轴').props.onClick(); await tick() })
    await act(async () => { button(renderer, '点击生成时间轴').props.onClick(); await tick() })

    expect(mocks.callArkme).toHaveBeenCalledWith('recordings.generate', {
      dateStamp: expect.any(Number), kind: 'timeline',
    }, expect.any(AbortSignal))

    await act(async () => {
      finishSummary?.({ state: 'processing', message: '内容仍在生成', items: [] })
      await tick()
    })
  })

  it('restores the matching empty action after an owner failure so normal use is not blocked', async () => {
    let attempts = 0
    const originalImplementation = mocks.callArkme.getMockImplementation()!
    mocks.callArkme.mockImplementation(async (operation, params, signal) => {
      if (operation === 'recordings.generate' && params?.kind === 'summary') {
        attempts += 1
        if (attempts === 1) throw new Error('生成服务暂时不可用')
      }
      return await originalImplementation(operation, params, signal)
    })
    await act(async () => {
      renderer = create(<ArkmeRecordingSurface onOpenRecordingImport={() => {}} recordingRefreshRevision={0} />)
      await tick()
    })

    await act(async () => { button(renderer, '总结').props.onClick(); await tick() })
    await act(async () => { button(renderer, '点击生成总结').props.onClick(); await tick() })

    expect(renderedText(renderer.root)).toContain('生成服务暂时不可用')
    expect(button(renderer, '点击生成总结')).toBeDefined()

    await act(async () => { button(renderer, '点击生成总结').props.onClick(); await tick() })
    expect(attempts).toBe(2)
    expect(renderedText(renderer.root)).toContain('生成总结中...')
  })

  it('aborts an in-flight generation when the account-scoped recording surface unmounts', async () => {
    let requestSignal: AbortSignal | undefined
    const originalImplementation = mocks.callArkme.getMockImplementation()!
    mocks.callArkme.mockImplementation(async (operation, params, signal) => {
      if (operation === 'recordings.generate' && params?.kind === 'summary') {
        requestSignal = signal
        return await new Promise(() => undefined)
      }
      return await originalImplementation(operation, params, signal)
    })
    await act(async () => {
      renderer = create(<ArkmeRecordingSurface onOpenRecordingImport={() => {}} recordingRefreshRevision={0} />)
      await tick()
    })

    await act(async () => { button(renderer, '总结').props.onClick(); await tick() })
    await act(async () => { button(renderer, '点击生成总结').props.onClick(); await tick() })
    expect(requestSignal?.aborted).toBe(false)

    await act(async () => { renderer.unmount(); await tick() })
    expect(requestSignal?.aborted).toBe(true)
  })

  it('uses the desktop model chooser before regenerating an existing version', async () => {
    const originalImplementation = mocks.callArkme.getMockImplementation()!
    mocks.callArkme.mockImplementation(async (operation, params, signal) => {
      if (operation === 'recordings.day') {
        const dateStamp = Number(params?.dateStamp)
        return {
          dateStamp, totalDurationMillis: 5_000,
          transcript: {
            state: 'ready', message: '', totalDurationMillis: 5_000, processingCount: 0,
            items: [{
              itemId: 'item-1', itemRef: 'opaque-item', startAtMillis: dateStamp + 1_000,
              endAtMillis: dateStamp + 6_000, speakerNumber: 1, speakerKey: 'opaque-speaker',
              speakerColorIndex: 0, speakerLabel: '我', sameSpeakerItemCount: 1,
              isSelf: true, isBackground: false, text: '完成评审',
            }],
          },
          summary: {
            state: 'ready', message: '', items: [{
              id: 'summary-1', status: 'done', selectable: true, generationStage: 2,
              generatedAtMillis: dateStamp + 8_000, modelDisplayName: 'Qwen3 Max',
              content: '## 今日总结', timelineEvents: [], error: '',
            }],
          },
          timeline: { state: 'empty', message: '暂无已生成内容', items: [] },
        }
      }
      return await originalImplementation(operation, params, signal)
    })
    await act(async () => {
      renderer = create(<ArkmeRecordingSurface onOpenRecordingImport={() => {}} recordingRefreshRevision={0} />)
      await tick()
    })
    await act(async () => { button(renderer, '总结').props.onClick(); await tick() })
    const today = new Date()
    const expectedVersionTime = `${String(today.getFullYear())}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')} 00:00:08`
    expect(renderedText(renderer.root)).toContain(`${expectedVersionTime} · Qwen3 Max`)
    expect(renderer.root.findByProps({ 'aria-label': '切换总结版本' }).props.style).toMatchObject({
      width: 320, height: 36, borderRadius: 10,
    })
    await act(async () => { button(renderer, '重新生成').props.onClick(); await tick() })

    const dialog = renderer.root.findByProps({ 'aria-label': '选择总结生成模型' })
    const modelPicker = dialog.findByProps({ 'aria-label': '选择生成模型' })
    expect(modelPicker.type).toBe('button')
    await act(async () => {
      modelPicker.props.onClick({ currentTarget: { getBoundingClientRect: () => ({ left: 100, right: 380, top: 100, bottom: 136 }) } })
      await tick()
    })
    const modelOptions = renderer.root.findByProps({ 'aria-label': '选择生成模型选项' })
    await act(async () => {
      modelOptions.findAll(node => node.type === 'button' && renderedText(node).includes('GLM-5'))[0]!.props.onClick()
      await tick()
    })
    await act(async () => { button(renderer, '确认').props.onClick(); await tick() })

    expect(mocks.callArkme).toHaveBeenCalledWith('recordings.summary-model-config.set', {
      routeKey: 'dashscope/glm-5',
    }, expect.any(AbortSignal))
    expect(mocks.callArkme).toHaveBeenCalledWith('recordings.generate', {
      dateStamp: expect.any(Number), kind: 'summary', routeKey: 'dashscope/glm-5',
    }, expect.any(AbortSignal))
  })

  it('lets an existing version recover from a transient model-config failure', async () => {
    const originalImplementation = mocks.callArkme.getMockImplementation()!
    let modelConfigReads = 0
    mocks.callArkme.mockImplementation(async (operation, params, signal) => {
      if (operation === 'recordings.summary-model-config') {
        modelConfigReads += 1
        if (modelConfigReads === 1) throw new Error('模型配置暂时不可用')
      }
      if (operation === 'recordings.day') {
        const day = await originalImplementation(operation, params, signal)
        return {
          ...day,
          summary: {
            state: 'ready', message: '', items: [{
              id: 'summary-1', status: 'done', selectable: true, generationStage: 2,
              generatedAtMillis: Number(params?.dateStamp) + 8_000, modelDisplayName: 'Qwen3 Max',
              content: '## 今日总结', timelineEvents: [], error: '',
            }],
          },
        }
      }
      return await originalImplementation(operation, params, signal)
    })

    await act(async () => {
      renderer = create(<ArkmeRecordingSurface onOpenRecordingImport={() => {}} recordingRefreshRevision={0} />)
      await tick()
      await tick()
    })
    await act(async () => { button(renderer, '总结').props.onClick(); await tick() })

    const regenerate = button(renderer, '重新生成')
    expect(regenerate.props.disabled).toBe(false)
    await act(async () => { regenerate.props.onClick(); await tick(); await tick() })

    expect(modelConfigReads).toBe(2)
    expect(renderer.root.findByProps({ 'aria-label': '选择总结生成模型' })).toBeDefined()
  })
})
