import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ callArkme: vi.fn() }))
vi.mock('../src/client/api.js', () => ({
  callArkme: mocks.callArkme,
  ArkmeClientError: class ArkmeClientError extends Error { body = { message: this.message } },
}))

import { arkmeAuthStore } from '../src/client/auth-store.js'
import { ArkmeRecordingSurface } from '../src/client/ArkmeRecordingSurface.js'
import { ArkmeRecordingSpeakerEditor } from '../src/client/recordings/ArkmeRecordingSpeakerEditor.js'
import type { ArkmeRecordingWorkbenchItem } from '../src/types.js'

const tick = async () => { await Promise.resolve(); await Promise.resolve() }

describe('recording transcript speaker popover', () => {
  let renderer: ReactTestRenderer
  let items: ArkmeRecordingWorkbenchItem[]

  beforeEach(() => {
    items = [{
      itemId: 'item-1', itemRef: 'sealed-item-1', transcriptSource: 'system', sessionKey: 'session-1',
      startAtMillis: 1_000, endAtMillis: 2_000, speakerNumber: 1, speakerKey: 'speaker:1',
      speakerColorIndex: 1, speakerLabel: '说话人 1', sameSpeakerItemCount: 1,
      isSelf: false, isBackground: false, text: '转写内容',
    }]
    arkmeAuthStore.setAuth({ status: 'authenticated', environment: 'test', userId: 42 })
    mocks.callArkme.mockReset().mockImplementation(async operation => {
      if (operation === 'recordings.totals.index') return { items: [], nextOffset: null }
      if (operation === 'recordings.calendar') return { fromStamp: 0, toStamp: 1, days: [] }
      if (operation === 'recordings.day') return {
        dateStamp: 1,
        totalDurationMillis: 1_000,
        transcript: { viewRef: 'fixture-view', nextCursor: '', transcriptSource: 'system',
          state: 'ready',
          message: '',
          totalDurationMillis: 1_000,
          processingCount: 0,
          items,
        },
        summary: { state: 'empty', message: '', items: [] },
        timeline: { state: 'empty', message: '', items: [] },
      }
      if (operation === 'recordings.speaker.options') return []
      if (operation === 'recordings.summary-model-config') return {
        defaultRouteKey: '', effectiveRouteKey: '', personalRouteKey: '', options: [],
      }
      throw new Error(`unexpected operation: ${String(operation)}`)
    })
    vi.stubGlobal('window', { addEventListener: vi.fn(), removeEventListener: vi.fn() })
    vi.stubGlobal('document', {
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })
  })

  afterEach(async () => {
    await act(async () => { renderer?.unmount(); await tick() })
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('opens the real speaker editor from the transcript speaker button', async () => {
    await act(async () => {
      renderer = create(<ArkmeRecordingSurface
        onOpenRecordingImport={() => undefined}
        recordingRefreshRevision={0}
      />)
      await tick()
    })

    const button = renderer.root.findByProps({ 'data-recording-transcript-item': 'item-1' }).findByProps({ 'aria-label': '编辑说话人 说话人 1' })
    await act(async () => {
      button.props.onClick({
        stopPropagation() {},
        currentTarget: {
          getBoundingClientRect: () => ({ left: 24, right: 104, top: 120, bottom: 142 }),
        },
      })
      await tick()
    })

    expect(renderer.root.findByProps({ 'aria-label': '编辑说话人' })).toBeDefined()
    expect(mocks.callArkme.mock.calls.filter(([operation]) => operation === 'recordings.speaker.options'))
      .toHaveLength(1)
  })

  it('keeps a repeated speaker individually editable without enabling batch changes', async () => {
    items.push({ ...items[0]!, itemId: 'item-2', itemRef: 'sealed-item-2', startAtMillis: 2_000, endAtMillis: 3_000 })
    await act(async () => {
      renderer = create(<ArkmeRecordingSurface onOpenRecordingImport={() => undefined} recordingRefreshRevision={0} />)
      await tick()
    })
    const button = renderer.root.findByProps({ 'data-recording-transcript-item': 'item-2' })
      .findByProps({ 'aria-label': '编辑说话人 说话人 1' })
    expect(button.props['data-recording-speaker-repeated']).toBe(true)
    const stopPropagation = vi.fn()
    await act(async () => {
      button.props.onClick({ stopPropagation,
        currentTarget: { getBoundingClientRect: () => ({ left: 24, right: 104, top: 144, bottom: 166 }) },
      })
      await tick()
    })
    expect(stopPropagation).toHaveBeenCalledOnce()
    const editor = renderer.root.findByType(ArkmeRecordingSpeakerEditor)
    expect(editor.props.item.itemRef).toBe('sealed-item-2')
    expect(editor.props.initialBatchUpdate).toBe(false)
    expect(button.props['aria-expanded']).toBe(true)
  })

  it('restarts visible identity for a different person, recording, source, or a return after another speaker', async () => {
    const base = items[0]!
    const variants: Partial<ArkmeRecordingWorkbenchItem>[] = [
      {}, {}, { speakerKey: 'speaker:2' }, {}, { sessionKey: 'session-2' },
      { transcriptSource: 'doubao' }, { isSelf: true },
      { speakerKey: '' }, { speakerKey: '' },
    ]
    items = variants.map((change, index) => ({ ...base, ...change,
      itemId: `item-${index}`, itemRef: `sealed-item-${index}`,
      startAtMillis: index * 1_000, endAtMillis: (index + 1) * 1_000,
    }))
    await act(async () => {
      renderer = create(<ArkmeRecordingSurface onOpenRecordingImport={() => undefined} recordingRefreshRevision={0} />)
      await tick()
    })
    const repeated = items.map(item => renderer.root.findByProps({ 'data-recording-transcript-item': item.itemId })
      .findByProps({ 'aria-label': '编辑说话人 说话人 1' }).props['data-recording-speaker-repeated'] === true)
    expect(repeated).toEqual([false, true, false, false, false, false, false, false, false])
  })
  it.each([
    { status: 'logged-out' as const, environment: 'test' as const },
    { status: 'expired' as const, environment: 'test' as const, userId: 42 },
    { status: 'authenticated' as const, environment: 'test' as const, userId: 43 },
    { status: 'authenticated' as const, environment: 'prod' as const, userId: 42 },
  ])('closes the old item editor when its account context changes: %j', async auth => {
    await act(async () => {
      renderer = create(<ArkmeRecordingSurface onOpenRecordingImport={() => undefined} recordingRefreshRevision={0} />)
      await tick()
    })
    await act(async () => {
      renderer.root.findByProps({ 'data-recording-transcript-item': 'item-1' }).findByProps({ 'aria-label': '编辑说话人 说话人 1' }).props.onClick({
        stopPropagation() {},
        currentTarget: { getBoundingClientRect: () => ({ left: 24, right: 104, top: 120, bottom: 142 }) },
      })
      await tick()
    })
    expect(renderer.root.findAllByProps({ 'aria-label': '编辑说话人' })).toHaveLength(1)
    await act(async () => { arkmeAuthStore.setAuth(auth); await tick() })
    expect(renderer.root.findAllByProps({ 'aria-label': '编辑说话人' })).toHaveLength(0)
  })

})
