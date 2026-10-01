import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { describe, expect, it, vi } from 'vitest'
import { RecognizedSpeakerEntry } from '../src/client/recordings/RecognizedSpeakerEntry.js'
import { RecognizedSpeakerDirectory } from '../src/client/recognized-speaker-directory.js'
import { loaders, summary, deferred } from './helpers/speaker-directory.js'
const flush = async () => { for (let i = 0; i < 25; i++) await Promise.resolve() }
const text = (renderer: ReactTestRenderer) => JSON.stringify(renderer.toJSON())
describe('recognized speaker entry', () => {
  it('fetches only summary and never clears unseen merely for displaying the entry', async () => {
    const api = loaders(), directory = new RecognizedSpeakerDirectory(api), open = vi.fn()
    let view!: ReactTestRenderer
    await act(async () => { view = create(<RecognizedSpeakerEntry accountKey="a" active onOpen={open} style={{}} directory={directory} />); await flush() })
    expect(text(view)).toContain('43'); expect(text(view)).toContain('新识别 3 个')
    expect(api.list).not.toHaveBeenCalled(); expect(api.seen).not.toHaveBeenCalled()
    act(() => view.root.findByType('button').props.onClick()); expect(open).toHaveBeenCalledTimes(1)
    act(() => view.unmount())
  })
  it('distinguishes unknown from complete zero and retains the entry when disabled', async () => {
    for (const [data, expected] of [[summary({ state: 'building', totalCount: null, unseenCount: null, coverage: 'unknown' }), '整理中'], [summary({ totalCount: 0, unseenCount: 0 }), '0'], [summary({ state: 'disabled', totalCount: null }), '目录暂不可用']] as const) {
      const directory = new RecognizedSpeakerDirectory(loaders({ summary: async () => data }))
      let view!: ReactTestRenderer
      await act(async () => { view = create(<RecognizedSpeakerEntry accountKey="a" active onOpen={() => {}} style={{}} directory={directory} />); await flush() })
      expect(text(view)).toContain(expected); expect(text(view)).not.toContain('新识别 3 个')
      act(() => view.unmount())
    }
  })
  it('hides prior-account numbers immediately while the next account loads', async () => {
    const delayed = deferred<ReturnType<typeof summary>>()
    const api = loaders({ summary: vi.fn().mockResolvedValueOnce(summary()).mockImplementation(() => delayed.promise) }), directory = new RecognizedSpeakerDirectory(api)
    let view!: ReactTestRenderer
    await act(async () => { view = create(<RecognizedSpeakerEntry accountKey="a" active onOpen={() => {}} style={{}} directory={directory} />); await flush() })
    await act(async () => { view.update(<RecognizedSpeakerEntry accountKey="b" active onOpen={() => {}} style={{}} directory={directory} />); await flush() })
    expect(text(view)).not.toContain('新识别 3 个'); expect(text(view)).not.toContain('"43"')
    act(() => view.unmount()); directory.clear()
  })
})

it('does not claim missing voiceprint when its status request fails', async () => {
  const { SpeakerSelfGuide } = await import('../src/client/recordings/SpeakerSelfGuide.js')
  let view!: ReactTestRenderer
  await act(async () => { view = create(<SpeakerSelfGuide onOpenRecordings={() => {}} readVoiceprint={async () => { throw new Error('offline') }} />); await flush() })
  expect(text(view)).toContain('声纹状态暂不可用'); expect(text(view)).not.toContain('还没有标记你的声音')
  act(() => view.unmount())
})
