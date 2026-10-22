import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, expect, it, vi } from 'vitest'
import type { ArkmeRecordingWorkbenchItem } from '../src/types.js'

const probe = vi.hoisted(() => ({ call: vi.fn(), textRenders: 0 }))
vi.mock('../src/client/api.js', async original => ({ ...await original<typeof import('../src/client/api.js')>(), callArkme: probe.call }))
vi.mock('../src/client/ArkmeMessageTextSelection.js', async original => {
  const actual = await original<typeof import('../src/client/ArkmeMessageTextSelection.js')>()
  return { ...actual, useMessageTextSelectionTarget: (...args: Parameters<typeof actual.useMessageTextSelectionTarget>) => {
    probe.textRenders++
    return actual.useMessageTextSelectionTarget(...args)
  } }
})
import { ArkmeRecordingSurface } from '../src/client/ArkmeRecordingSurface.js'
import { ArkmeActionMenu } from '../src/client/ArkmeDshMenu.js'

let renderer: ReactTestRenderer | undefined
afterEach(async () => {
  await act(async () => renderer?.unmount())
  vi.useRealTimers(); vi.unstubAllGlobals()
})

// Assert bounded render work, not wall-clock time, so slower CI hosts remain reliable.
it('opens, retargets and closes a context menu without rerendering a 3448-row day or reading data', async () => {
  vi.useFakeTimers(); vi.setSystemTime(new Date(2026, 9, 20, 12))
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal('requestAnimationFrame', () => 1); vi.stubGlobal('cancelAnimationFrame', () => {})
  vi.stubGlobal('HTMLElement', class {})
  vi.stubGlobal('document', { body: {}, activeElement: null, getSelection: () => null, addEventListener() {}, removeEventListener() {} })
  vi.stubGlobal('window', { innerWidth: 1400, innerHeight: 900, addEventListener() {}, removeEventListener() {} })
  const items = Array.from({ length: 3448 }, (_, i): ArkmeRecordingWorkbenchItem => ({
    itemId: `row-${i}`, itemRef: `ref-${i}`, sessionKey: 'session', transcriptSource: 'system',
    startAtMillis: i * 5000, endAtMillis: i * 5000 + 4000,
    speakerNumber: 1, speakerKey: 'speaker', speakerColorIndex: 0, speakerLabel: '说话人',
    sameSpeakerItemCount: 3448, isSelf: false, isBackground: false, text: `转写片段 ${i}`,
  }))
  probe.call.mockImplementation(async (operation, params) => {
    if (operation === 'recordings.calendar') return { days: [] }
    if (operation === 'recordings.summary-model-config') return { options: [] }
    if (operation === 'recordings.day') return { dateStamp: params.dateStamp,
      transcript: { items, state: 'ready', message: '', totalDurationMillis: 3448 * 4000, processingCount: 0 },
      summary: { state: 'empty', items: [] }, timeline: { state: 'empty', items: [] } }
    throw new Error(operation)
  })
  await act(async () => { renderer = create(<ArkmeRecordingSurface onOpenRecordingImport={() => {}} recordingRefreshRevision={0} />, {
    createNodeMock: () => ({ setAttribute() {}, removeAttribute() {}, querySelector: () => null, querySelectorAll: () => [], addEventListener() {}, removeEventListener() {} }),
  }) })
  const before = probe.textRenders, requests = probe.call.mock.calls.length
  for (const index of [0, 1724, 3447]) {
    await act(async () => renderer!.root.findAllByProps({ 'data-recording-transcript-item': `row-${index}` })[0]!.props.onContextMenu({
      preventDefault() {}, stopPropagation() {}, clientX: 10 + index, clientY: 10,
    }))
    expect(renderer!.root.findAllByProps({ role: 'menuitem' })).toHaveLength(3)
    expect(probe.textRenders).toBe(before)
  }
  await act(async () => renderer!.root.findByType(ArkmeActionMenu).props.onClose())
  expect(renderer!.root.findAllByProps({ role: 'menuitem' })).toHaveLength(0)
  expect(probe.textRenders).toBe(before)
  expect(probe.call.mock.calls).toHaveLength(requests)
})
