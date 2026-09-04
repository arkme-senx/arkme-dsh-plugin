import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ArkmeRecordingComparison, ArkmeRecordingDay, ArkmeRecordingWorkbenchItem } from '../src/types.js'
const mocks = vi.hoisted(() => ({ call: vi.fn() }))
vi.mock('../src/client/api.js', async original => ({ ...await original<typeof import('../src/client/api.js')>(), callArkme: mocks.call }))
import { prepareRecordingTranscriptComparison } from '../src/client/recordings/prepare-recording-transcript-comparison.js'
import { RecordingTranscriptComparison } from '../src/client/recordings/RecordingTranscriptComparison.js'
import { RecordingTranscriptForward } from '../src/client/recordings/RecordingTranscriptForward.js'
import { createRecordingForwardAttempt } from '../src/client/recordings/recording-forward-client.js'
import { ArkmeRecordingSurface } from '../src/client/ArkmeRecordingSurface.js'

const item = (id: string, sessionKey = 'session'): ArkmeRecordingWorkbenchItem => ({
  itemId: id, itemRef: `ref-${id}`, sessionKey, transcriptSource: 'system', startAtMillis: 1_000, endAtMillis: 5_000,
  speakerNumber: 1, speakerKey: 'speaker', speakerColorIndex: 0, speakerLabel: '说话人', sameSpeakerItemCount: 1, isSelf: false, isBackground: false, text: '😀你好你好',
})
const section = (items: ArkmeRecordingWorkbenchItem[]) => ({ items, state: items.length > 0 ? 'ready' as const : 'empty' as const, message: '', totalDurationMillis: 4_000, processingCount: 0 })
const comparison = (): ArkmeRecordingComparison => ({ dateStamp: 0, system: section([item('system')]), doubao: section([]), candidateCount: 0, failedCount: 0, silentCount: 0 })
let renderer: ReactTestRenderer
beforeEach(() => {
  vi.useFakeTimers(); mocks.call.mockReset()
  vi.stubGlobal('document', { activeElement: null, addEventListener() {}, removeEventListener() {} })
  vi.stubGlobal('HTMLElement', class {})
})
afterEach(async () => { await act(async () => { renderer?.unmount() }); vi.useRealTimers(); vi.unstubAllGlobals() })

describe('transcript comparison lifecycle', () => {
  it('opens existing Doubao results without starting additional work', async () => {
    const existing = comparison(); existing.candidateCount = 1; existing.doubao = section([item('doubao')])
    mocks.call.mockResolvedValue(existing)
    const prepared = await prepareRecordingTranscriptComparison(0, new AbortController().signal)
    await act(async () => { renderer = create(<RecordingTranscriptComparison dateStamp={0} mediaPath="/media" prepared={prepared} onClose={() => {}} />) })
    expect(mocks.call.mock.calls.map(([operation]) => operation)).toEqual(['recordings.compare'])
    expect(renderer.root.findByProps({ role: 'dialog' }).props.style.inset).toBe(0)
    const row = renderer.root.findAllByProps({ 'data-transcript-time': 1000 })[0]!
    expect(row.props.onClick).toBeUndefined()
    expect(row.props.onDoubleClick).toBeTypeOf('function')
  })

  it('double-clicks the exact system counterpart and continues its playlist despite overlapping sessions', async () => {
    const audios: Array<EventTarget & { currentTime: number; pause: ReturnType<typeof vi.fn> }> = []
    vi.stubGlobal('Audio', class extends EventTarget {
      currentTime = 0
      pause = vi.fn(() => { this.dispatchEvent(new Event('pause')) })
      async play() { this.dispatchEvent(new Event('play')) }
      constructor() { super(); audios.push(this) }
    })
    const initial = comparison()
    const selected = item('target', 'right-session')
    const next = { ...item('next', 'right-session'), startAtMillis: 6000, endAtMillis: 9000 }
    initial.system = section([item('a-wrong-session', 'wrong-session'), selected, next])
    initial.doubao = section([{ ...item('doubao', 'right-session'), transcriptSource: 'doubao', startAtMillis: 5500, endAtMillis: 5900 }])
    mocks.call.mockResolvedValue({ playbackRef: 'media', startOffsetMillis: 0, endOffsetMillis: 4000 })
    await act(async () => { renderer = create(<RecordingTranscriptComparison dateStamp={0} mediaPath="/media" prepared={{ data: initial, pending: false, notice: '' }} onClose={() => {}} />) })
    const row = renderer.root.findByProps({ 'data-transcript-time': 5500 })
    expect(row.props.onClick).toBeUndefined()
    await act(async () => { row.props.onDoubleClick() })
    expect(mocks.call.mock.calls[0]?.[1]).toEqual({ itemRef: 'ref-target' })
    // Flutter starts the nearest segment at its beginning when the time falls outside it.
    expect(audios[0]?.currentTime).toBe(0)
    expect(renderer.root.findAllByProps({ 'aria-label': '暂停播放' }).length).toBeGreaterThan(0)
    await act(async () => { audios[0]!.dispatchEvent(new Event('ended')) })
    expect(mocks.call.mock.calls[1]?.[1]).toEqual({ itemRef: 'ref-next' })
    await act(async () => { renderer.unmount() })
    expect(audios[1]?.pause).toHaveBeenCalled()
  })

  it('opens an accepted task, polls only pending work and stops after completion', async () => {
    const initial = comparison(); initial.candidateCount = 1
    const pending = comparison(); pending.doubao.processingCount = 1
    const complete = comparison(); complete.doubao = section([item('complete')])
    mocks.call.mockResolvedValueOnce(initial).mockResolvedValueOnce({ queuedCount: 1, inFlightCount: 0, missingAudioCount: 1 }).mockResolvedValueOnce(pending).mockResolvedValue(complete)
    const prepared = await prepareRecordingTranscriptComparison(0, new AbortController().signal)
    await act(async () => { renderer = create(<RecordingTranscriptComparison dateStamp={0} mediaPath="/media" prepared={prepared} onClose={() => {}} />) })
    expect(JSON.stringify(renderer.toJSON())).toContain('历史音频留存已过期')
    await act(async () => { await vi.advanceTimersByTimeAsync(6_000) })
    expect(mocks.call).toHaveBeenCalledTimes(4)
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000) })
    expect(mocks.call).toHaveBeenCalledTimes(4)
  })

  it('does not offer a transcript reload for a missing playback counterpart', async () => {
    const initial = comparison()
    initial.doubao = section([{ ...item('doubao', 'other-session'), transcriptSource: 'doubao', startAtMillis: 10_000 }])
    await act(async () => { renderer = create(<RecordingTranscriptComparison dateStamp={0} mediaPath="/media" prepared={{ data: initial, pending: false, notice: '' }} onClose={() => {}} />) })
    await act(async () => { renderer.root.findByProps({ 'data-transcript-time': 10_000 }).props.onDoubleClick() })
    expect(JSON.stringify(renderer.toJSON())).toContain('该片段暂无可播放的系统录音')
    expect(renderer.root.findAllByType('button').filter(button => button.children.includes('重试'))).toHaveLength(0)
    expect(mocks.call).not.toHaveBeenCalled()
  })

  it('does not open an empty comparison when audio has expired', async () => {
    const initial = comparison(); initial.candidateCount = 1
    mocks.call.mockResolvedValueOnce(initial).mockResolvedValueOnce({ queuedCount: 0, inFlightCount: 0, missingAudioCount: 1 })
    await expect(prepareRecordingTranscriptComparison(0, new AbortController().signal)).rejects.toThrow('历史音频留存已过期')
    expect(mocks.call).toHaveBeenCalledTimes(2)
  })

  it('never starts backfill after a cancelled date read returns late', async () => {
    const initial = comparison(); initial.candidateCount = 1
    const controller = new AbortController()
    mocks.call.mockImplementationOnce(async () => { controller.abort(); return initial })
    await expect(prepareRecordingTranscriptComparison(0, controller.signal)).rejects.toThrow()
    expect(mocks.call.mock.calls.map(([op]) => op)).toEqual(['recordings.compare'])
  })

  it('does not abandon existing pending work when a new backfill fails', async () => {
    const initial = comparison(); initial.candidateCount = 1; initial.doubao.processingCount = 1
    mocks.call.mockResolvedValueOnce(initial).mockRejectedValueOnce(new Error('offline'))
    await expect(prepareRecordingTranscriptComparison(0, new AbortController().signal)).resolves.toMatchObject({ pending: true })
  })

  it('keeps text readable on polling failure and offers retry only for that failure', async () => {
    const initial = comparison(); initial.doubao.processingCount = 1
    const prepared = { data: initial, pending: true, notice: '' }
    mocks.call.mockRejectedValueOnce(new Error('读取失败')).mockResolvedValue(comparison())
    await act(async () => { renderer = create(<RecordingTranscriptComparison dateStamp={0} mediaPath="/media" prepared={prepared} onClose={() => {}} />) })
    expect(renderer.root.findAllByType('button').filter(button => button.children.includes('刷新'))).toHaveLength(0)
    await act(async () => { await vi.advanceTimersByTimeAsync(3_000) })
    expect(JSON.stringify(renderer.toJSON())).toContain('你好')
    expect(JSON.stringify(renderer.toJSON())).toContain('读取失败')
    await act(async () => { renderer.root.findAllByType('button').find(button => button.children.includes('重试'))!.props.onClick() })
    expect(JSON.stringify(renderer.toJSON())).not.toContain('读取失败')
    const signal = mocks.call.mock.calls.at(-1)?.[2] as AbortSignal
    await act(async () => { renderer.unmount(); await vi.advanceTimersByTimeAsync(10_000) })
    expect(signal.aborted).toBe(true)
    expect(mocks.call).toHaveBeenCalledTimes(2)
  })
})

describe('transcript forwarding interaction', () => {
  const target = (key: string) => ({ sourceKey: key, sourceRef: `target-${key}`, displayName: key, kind: 'private_chat', activeAtMillis: 0, unreadCount: 0 })
  const attempt = () => createRecordingForwardAttempt([item('one')])
  const sendButton = () => renderer.root.findAllByType('button').find(button => ['发送录音', '正在转发'].includes(button.props['aria-label']))!

  it('composes the separate Record directory into the Chat root without inventing a self capability', async () => {
    const self = { ...target('self'), kind: 'send_to_self', sourceRef: 'owner-self-ref', displayName: '发给自己' }
    const topic = { ...target('topic'), kind: 'topic', topicHierarchyKey: 'topic-key', displayName: '主题' }
    mocks.call.mockImplementation(async (operation, params) => {
      if (operation === 'recordings.forward.capabilities') return { recordTargetsSupported: true }
      if (operation === 'sources.list') return { items: params.directory === 'root' ? [target('chat')] : [self, topic], hasMore: false }
      return { recordUid: 'confirmed' }
    })
    await act(async () => { renderer = create(<RecordingTranscriptForward attempt={attempt()} onClose={() => {}} onComplete={() => {}} />) })
    expect(renderer.root.findAllByProps({ type: 'checkbox' })).toHaveLength(2)
    expect(renderer.root.findByProps({ 'aria-label': '选择自己和主题' }).props.disabled).toBe(false)
    await act(async () => { renderer.root.findByProps({ 'aria-label': '选择发送对象 发给自己' }).props.onChange({ target: { checked: true } }) })
    await act(async () => { sendButton().props.onClick() })
    expect(mocks.call.mock.calls.find(([op]) => op === 'recordings.forward')?.[1]).toHaveProperty('targetSourceRef', 'owner-self-ref')
    await act(async () => { renderer.root.findByProps({ 'aria-label': '选择自己和主题' }).props.onClick() })
    expect(renderer.root.findByProps({ 'aria-label': '选择发送对象 主题' })).toBeTruthy()
  })

  it('keeps Chat usable when the independent self directory fails and retries it in place', async () => {
    let fail = true
    mocks.call.mockImplementation(async (operation, params) => {
      if (operation === 'recordings.forward.capabilities') return { recordTargetsSupported: true }
      if (params.directory === 'send_to_self') {
        if (fail) throw new Error('Record unavailable')
        return { items: [{ ...target('self'), kind: 'send_to_self', displayName: '发给自己' }], hasMore: false }
      }
      return { items: [target('chat')], hasMore: false }
    })
    await act(async () => { renderer = create(<RecordingTranscriptForward attempt={attempt()} onClose={() => {}} onComplete={() => {}} />) })
    expect(renderer.root.findByProps({ 'aria-label': '选择发送对象 chat' }).props.disabled).toBe(false)
    expect(JSON.stringify(renderer.toJSON())).toContain('未能读取发给自己入口')
    fail = false
    await act(async () => { renderer.root.findAllByType('button').find(button => button.children.includes('重试'))!.props.onClick() })
    expect(renderer.root.findByProps({ 'aria-label': '选择发送对象 发给自己' }).props.disabled).toBe(false)
    expect(JSON.stringify(renderer.toJSON())).not.toContain('未能读取发给自己入口')
  })

  it('shows the preview and comment only after selection and limits selection to five targets', async () => {
    mocks.call.mockImplementation(async operation => operation === 'recordings.forward.capabilities'
      ? { recordTargetsSupported: true }
      : { items: Array.from({ length: 6 }, (_, i) => target(String(i))), hasMore: false })
    await act(async () => { renderer = create(<RecordingTranscriptForward attempt={attempt()} onClose={() => {}} onComplete={() => {}} />) })
    expect(renderer.root.findAllByType('textarea')).toHaveLength(0)
    for (let index = 0; index < 6; index++) await act(async () => { renderer.root.findAllByProps({ type: 'checkbox' })[index]!.props.onChange({ target: { checked: true } }) })
    expect(renderer.root.findAllByProps({ type: 'checkbox' }).filter(box => box.props.checked)).toHaveLength(5)
    expect(JSON.stringify(renderer.toJSON())).toContain('最多选择 5 个发送对象')
    expect(renderer.root.findByProps({ 'aria-label': '录音转发预览' })).toBeTruthy()
    expect(renderer.root.findByType('textarea').props.placeholder).toBe('说点什么...')
    await act(async () => { renderer.root.findAllByProps({ type: 'checkbox' })[0]!.props.onChange({ target: { checked: false } }) })
    await act(async () => { renderer.root.findAllByProps({ type: 'checkbox' })[5]!.props.onChange({ target: { checked: true } }) })
    expect(renderer.root.findAllByProps({ type: 'checkbox' })[5]!.props.checked).toBe(true)
  })

  it('freezes the original comment and IDs across uncertain sends and reports a confirmed card warning', async () => {
    const draft = attempt(); const complete = vi.fn(); let fail = true
    mocks.call.mockImplementation(async operation => {
      if (operation === 'recordings.forward.capabilities') return { recordTargetsSupported: true }
      if (operation === 'sources.list') return { items: [target('a')], hasMore: false }
      if (fail) throw new Error('timeout')
      return { recordUid: 'confirmed', warningText: '录音已转发，附言发送失败' }
    })
    await act(async () => { renderer = create(<RecordingTranscriptForward attempt={draft} onClose={() => {}} onComplete={complete} />) })
    await act(async () => { renderer.root.findByProps({ type: 'checkbox' }).props.onChange({ target: { checked: true } }) })
    await act(async () => { renderer.root.findByType('textarea').props.onChange({ target: { value: '原始附言' } }) })
    await act(async () => { sendButton().props.onClick() })
    expect(renderer.root.findByType('textarea').props.readOnly).toBe(true)
    expect(complete).not.toHaveBeenCalled()
    fail = false
    await act(async () => { sendButton().props.onClick() })
    const sends = mocks.call.mock.calls.filter(([op]) => op === 'recordings.forward')
    expect(sends[0]?.[1]).toEqual(sends[1]?.[1])
    expect(sends[0]?.[1]).toMatchObject({ commentText: '原始附言', commentRecordUid: expect.any(String) })
    expect(complete).toHaveBeenCalledWith('录音已转发，附言发送失败')
  })

  it('continues subsequent destinations after one target times out', async () => {
    const draft = attempt()
    mocks.call.mockImplementation(async (operation, params, signal) => {
      if (operation === 'recordings.forward.capabilities') return { recordTargetsSupported: true }
      if (operation === 'sources.list') return { items: [target('a'), target('b')], hasMore: false }
      if (params.targetSourceRef === 'target-a') return await new Promise((_, reject) => signal.addEventListener('abort', () => { reject(new Error('响应超时')) }))
      return { recordUid: 'confirmed' }
    })
    await act(async () => { renderer = create(<RecordingTranscriptForward attempt={draft} onClose={() => {}} onComplete={() => {}} />) })
    await act(async () => { for (const checkbox of renderer.root.findAllByProps({ type: 'checkbox' })) checkbox.props.onChange({ target: { checked: true } }) })
    await act(async () => { sendButton().props.onClick(); await vi.advanceTimersByTimeAsync(30_000) })
    expect(mocks.call.mock.calls.filter(([operation]) => operation === 'recordings.forward').map(([, params]) => params.targetSourceRef)).toEqual(['target-a', 'target-b'])
    expect(draft.hasSent('b')).toBe(true)
    expect(sendButton().props.disabled).toBe(false)
  })

  it('keeps a renamed topic in the same delivery attempt when its capability ref rotates', async () => {
    const draft = attempt(); let renamed = false
    mocks.call.mockImplementation(async operation => {
      if (operation === 'recordings.forward.capabilities') return { recordTargetsSupported: true }
      if (operation === 'sources.list') return { items: [{ ...target('topic'), sourceKey: undefined, kind: 'topic', topicHierarchyKey: 'stable-topic', sourceRef: renamed ? 'new-topic-ref' : 'old-topic-ref' }], hasMore: false }
      return { recordUid: 'confirmed' }
    })
    await act(async () => { renderer = create(<RecordingTranscriptForward attempt={draft} onClose={() => {}} onComplete={() => {}} />) })
    await act(async () => { renderer.root.findByProps({ type: 'checkbox' }).props.onChange({ target: { checked: true } }) })
    await act(async () => { sendButton().props.onClick(); renderer.unmount() })
    renamed = true
    await act(async () => { renderer = create(<RecordingTranscriptForward attempt={draft} onClose={() => {}} onComplete={() => {}} />) })
    expect(renderer.root.findByProps({ type: 'checkbox' }).props.disabled).toBe(true)
    expect(renderer.root.findByProps({ type: 'checkbox' }).props.checked).toBe(true)
    expect(mocks.call.mock.calls.filter(([operation]) => operation === 'recordings.forward')).toHaveLength(1)
  })

  it('can retry a failed Record capability check without closing or losing Chat selection', async () => {
    let failed = true
    mocks.call.mockImplementation(async operation => {
      if (operation === 'recordings.forward.capabilities') { if (failed) throw new Error('offline'); return { recordTargetsSupported: true } }
      return { items: [target('a')], hasMore: false }
    })
    await act(async () => { renderer = create(<RecordingTranscriptForward attempt={attempt()} onClose={() => {}} onComplete={() => {}} />) })
    await act(async () => { renderer.root.findByProps({ type: 'checkbox' }).props.onChange({ target: { checked: true } }) })
    failed = false
    await act(async () => { renderer.root.findByProps({ 'aria-label': '重新检查转发能力' }).props.onClick() })
    expect(JSON.stringify(renderer.toJSON())).not.toContain('未能确认自己和主题的转发能力')
    expect(renderer.root.findByProps({ type: 'checkbox' }).props.checked).toBe(true)
  })

  it('offers one self destination rather than two labels that create the same uncategorized record', async () => {
    mocks.call.mockImplementation(async operation => operation === 'recordings.forward.capabilities'
      ? { recordTargetsSupported: true }
      : { items: [{ ...target('self'), kind: 'send_to_self' }, { ...target('uncategorized'), kind: 'default_category' }], hasMore: false })
    await act(async () => { renderer = create(<RecordingTranscriptForward attempt={attempt()} onClose={() => {}} onComplete={() => {}} />) })
    expect(renderer.root.findAllByProps({ type: 'checkbox' })).toHaveLength(1)
  })

  it('retains exact retry identity, skips successful destinations, and supports further target pages', async () => {
    const draft = attempt(); let bAttempts = 0
    mocks.call.mockImplementation(async (operation, params) => {
      if (operation === 'recordings.forward.capabilities') throw new Error('record unavailable')
      if (operation === 'sources.list') return { items: [target(params.cursor ? 'b' : 'a')], hasMore: !params.cursor, nextCursor: params.cursor ? undefined : 'page-2' }
      if (operation === 'recordings.forward') {
        if (params.targetSourceRef === 'target-b' && bAttempts++ === 0) throw new Error('响应超时')
        return { recordUid: 'confirmed' }
      }
      throw new Error(operation)
    })
    await act(async () => { renderer = create(<RecordingTranscriptForward attempt={draft} onClose={() => {}} onComplete={() => {}} />) })
    expect(JSON.stringify(renderer.toJSON())).toContain('未能确认自己和主题的转发能力')
    await act(async () => { renderer.root.findAllByType('button').find(button => button.children.includes('加载更多目标'))!.props.onClick() })
    await act(async () => { for (const checkbox of renderer.root.findAllByProps({ type: 'checkbox' })) checkbox.props.onChange({ target: { checked: true } }) })
    await act(async () => { sendButton().props.onClick() })
    await act(async () => { sendButton().props.onClick() })
    const sends = mocks.call.mock.calls.filter(([operation]) => operation === 'recordings.forward').map(([, params]) => params)
    expect(sends.map(params => params.targetSourceRef)).toEqual(['target-a', 'target-b', 'target-b'])
    expect(sends[1]).toEqual(sends[2])
    expect(draft.hasSent('a')).toBe(true); expect(draft.hasSent('b')).toBe(true)
    expect(sendButton().props.disabled).toBe(true)
  })

  it('guards reentry and lets a timed-out request be retried with the same IDs after reopening', async () => {
    const draft = attempt(); let pending = true
    mocks.call.mockImplementation(async (operation, params, signal) => {
      if (operation === 'recordings.forward.capabilities') return { recordTargetsSupported: true }
      if (operation === 'sources.list') return { items: [target('a')], hasMore: false }
      if (pending) return await new Promise((_, reject) => signal.addEventListener('abort', () => { reject(new Error('响应超时')) }))
      return { recordUid: 'confirmed' }
    })
    await act(async () => { renderer = create(<RecordingTranscriptForward attempt={draft} onClose={() => {}} onComplete={() => {}} />) })
    await act(async () => { renderer.root.findByProps({ type: 'checkbox' }).props.onChange({ target: { checked: true } }) })
    const button = sendButton()
    await act(async () => { button.props.onClick(); button.props.onClick() })
    expect(mocks.call.mock.calls.filter(([operation]) => operation === 'recordings.forward')).toHaveLength(1)
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000) })
    expect(sendButton().props.disabled).toBe(false)
    await act(async () => { renderer.unmount() })
    pending = false
    await act(async () => { renderer = create(<RecordingTranscriptForward attempt={draft} onClose={() => {}} onComplete={() => {}} />) })
    await act(async () => { renderer.root.findByProps({ type: 'checkbox' }).props.onChange({ target: { checked: true } }) })
    await act(async () => { sendButton().props.onClick() })
    const sends = mocks.call.mock.calls.filter(([operation]) => operation === 'recordings.forward')
    expect(sends[0]?.[1]).toEqual(sends[1]?.[1])
  })
})

it('searches every occurrence, navigates cyclically, clears on date changes, and restricts selection to one recording', async () => {
  vi.setSystemTime(new Date(2026, 8, 4, 12))
  const scroll = vi.fn()
  mocks.call.mockImplementation(async (operation, params) => {
    if (operation === 'recordings.calendar') return { days: [] }
    if (operation === 'recordings.summary-model-config') return { options: [] }
    if (operation === 'recordings.day') return { dateStamp: params.dateStamp, transcript: section([item('one'), item('two', 'other')]), summary: { state: 'empty', items: [] }, timeline: { state: 'empty', items: [] } } as ArkmeRecordingDay
    throw new Error(operation)
  })
  await act(async () => { renderer = create(<ArkmeRecordingSurface onOpenRecordingImport={() => {}} recordingRefreshRevision={0} />, { createNodeMock: () => ({ querySelector: () => ({ scrollIntoView: scroll }) }) }) })
  await act(async () => { renderer.root.findByProps({ 'aria-label': '搜索当天转写' }).props.onChange({ target: { value: '你好' } }) })
  expect(renderer.root.findAllByType('mark')).toHaveLength(4)
  await act(async () => { renderer.root.findByProps({ 'aria-label': '上一个匹配' }).props.onClick() })
  expect(JSON.stringify(renderer.toJSON())).toContain('4/4')
  expect(scroll).toHaveBeenCalled()
  await act(async () => { renderer.root.findByProps({ 'aria-label': '搜索当天转写' }).props.onKeyDown({ key: 'Enter', preventDefault() {} }) })
  expect(JSON.stringify(renderer.toJSON())).toContain('1/4')
  await act(async () => { renderer.root.findByProps({ 'aria-label': '多选' }).props.onClick() })
  await act(async () => { renderer.root.findAllByProps({ type: 'checkbox' })[0]!.props.onChange({ target: { checked: true } }) })
  await act(async () => { renderer.root.findAllByProps({ type: 'checkbox' })[1]!.props.onChange({ target: { checked: true } }) })
  expect(renderer.root.findAllByProps({ type: 'checkbox' })[1]!.props.checked).toBe(false)
  expect(JSON.stringify(renderer.toJSON())).toContain('请选择同一次录音')
  expect(renderer.root.findByProps({ 'aria-label': '录音多选操作' })).toBeTruthy()
  await act(async () => { renderer.root.findByProps({ 'aria-label': '9月3日' }).props.onClick() })
  expect(renderer.root.findByProps({ 'aria-label': '搜索当天转写' }).props.value).toBe('')
  expect(renderer.root.findAllByProps({ type: 'checkbox' })).toHaveLength(0)
  expect(renderer.root.findAllByProps({ 'aria-label': '编辑转写（开发中）' })).toHaveLength(0)
  for (const label of ['总结', '时间轴']) {
    await act(async () => { renderer.root.findAllByType('button').find(button => button.children.includes(label))!.props.onClick() })
    const pane = renderer.root.findByProps({ 'aria-label': '录音内容' }).parent!
    expect(pane.props.style.gridTemplateRows).toBe('40px minmax(0,1fr)')
  }
})

it('does not open a comparison for a previously selected date when its response arrives late', async () => {
  vi.setSystemTime(new Date(2026, 8, 4, 12))
  let resolveComparison!: (value: ArkmeRecordingComparison) => void
  mocks.call.mockImplementation(async (operation, params) => {
    if (operation === 'recordings.calendar') return { days: [] }
    if (operation === 'recordings.summary-model-config') return { options: [] }
    if (operation === 'recordings.compare') return await new Promise(resolve => { resolveComparison = resolve })
    if (operation === 'recordings.day') return { dateStamp: params.dateStamp, transcript: section([item('one')]), summary: { state: 'empty', items: [] }, timeline: { state: 'empty', items: [] } }
    throw new Error(operation)
  })
  await act(async () => { renderer = create(<ArkmeRecordingSurface onOpenRecordingImport={() => {}} recordingRefreshRevision={0} />) })
  await act(async () => { renderer.root.findByProps({ 'aria-label': '对比' }).props.onClick() })
  expect(renderer.root.findByProps({ 'aria-label': '正在准备转写对比' }).props.disabled).toBe(true)
  const signal = mocks.call.mock.calls.find(([op]) => op === 'recordings.compare')?.[2] as AbortSignal
  await act(async () => { renderer.root.findByProps({ 'aria-label': '9月3日' }).props.onClick() })
  const old = comparison(); old.doubao = section([item('late')])
  await act(async () => { resolveComparison(old) })
  expect(signal.aborted).toBe(true)
  expect(renderer.root.findAllByProps({ role: 'dialog' })).toHaveLength(0)
  expect(renderer.root.findByProps({ 'aria-label': '对比' }).props.disabled).toBe(false)
})
