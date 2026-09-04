import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ callArkme: vi.fn() }))
vi.mock('../src/client/api.js', () => ({
  callArkme: mocks.callArkme,
  ArkmeClientError: class ArkmeClientError extends Error { body = { message: this.message } },
}))

import { ArkmeRecordingSurface } from '../src/client/ArkmeRecordingSurface.js'

const tick = async () => { await Promise.resolve(); await Promise.resolve() }

describe('recording transcript speaker popover', () => {
  let renderer: ReactTestRenderer

  beforeEach(() => {
    mocks.callArkme.mockReset().mockImplementation(async operation => {
      if (operation === 'recordings.calendar') return { fromStamp: 0, toStamp: 1, days: [] }
      if (operation === 'recordings.day') return {
        dateStamp: 1,
        totalDurationMillis: 1_000,
        transcript: {
          state: 'ready',
          message: '',
          totalDurationMillis: 1_000,
          processingCount: 0,
          items: [{
            itemId: 'item-1',
            itemRef: 'sealed-item-1',
            startAtMillis: 1_000,
            endAtMillis: 2_000,
            speakerNumber: 1,
            speakerKey: 'speaker:1',
            speakerColorIndex: 1,
            speakerLabel: '说话人 1',
            sameSpeakerItemCount: 1,
            isSelf: false,
            isBackground: false,
            text: '转写内容',
          }],
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

    const button = renderer.root.findByProps({ 'aria-label': '编辑说话人 说话人 1' })
    await act(async () => {
      button.props.onClick({
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
})
