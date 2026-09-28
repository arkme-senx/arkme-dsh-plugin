import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { RecognizedSpeakerEntry } from '../src/client/recordings/RecognizedSpeakerEntry.js'
import { SpeakerSelfGuide } from '../src/client/recordings/SpeakerSelfGuide.js'
import { recognizedSpeakerTracker } from '../src/client/recognized-speaker-tracker.js'
import { RecognizedSpeakerDirectory } from '../src/client/recognized-speaker-directory.js'
import { ArkmeRecognizedSpeakersSurface } from '../src/client/ArkmeRecognizedSpeakersSurface.js'
import { arkmeUi } from '../src/client/ui-controller.js'
import type { ArkmeDirectoryPage, ArkmeMyVoiceprint, ArkmeRecordingSpeakerCandidate } from '../src/types.js'

const text = (node: ReactTestInstance): string => node.children.map(child => typeof child === 'string' ? child : text(child)).join('')
const flush = async () => { for (let n = 0; n < 12; n++) await Promise.resolve() }
const person = (id: string): ArkmeRecordingSpeakerCandidate => ({ kind: 'speaker', optionKey: id, personKey: 'one-person', speakerRef: id, label: id, isCurrentUser: false })
const row = (id: string): ArkmeDirectoryPage['items'][number] & { kind: 'unmarked-speaker' } => ({ kind: 'unmarked-speaker', candidateRef: id, identityKey: id, displayName: id, subtitle: '' })
const page = (ids: string[]): ArkmeDirectoryPage => ({ section: 'unmarked-speakers', items: ids.map(row), total: ids.length, hasMore: false, projectionState: 'fresh' })
afterEach(() => { recognizedSpeakerTracker.clearSession(); vi.restoreAllMocks(); vi.useRealTimers() })

describe('recognized speaker entry', () => {
  it('reuses entry data in the list and on return without another scan', async () => {
    const source = { marked: vi.fn(async () => [person('me')]), page: vi.fn(async () => page(['1', '2'])),
      presence: vi.fn(async () => ({ state: 'fresh' as const, scope: 'all-history' as const, items: [] })) }
    const directory = new RecognizedSpeakerDirectory(source, 0)
    let renderer!: ReactTestRenderer
    await act(async () => { renderer = create(<RecognizedSpeakerEntry accountKey="shared:1" active style={{}} onOpen={() => {}} directory={directory} />); await flush() })
    expect(text(renderer.root)).toContain('已识别说话人3')
    await act(async () => { renderer.update(<ArkmeRecognizedSpeakersSurface accountKey="shared:1" onBack={() => {}} directory={directory} />); await flush() })
    expect(renderer.root.findAllByProps({ className: 'arkme-recognized-speakers-row' })).toHaveLength(3)
    expect(text(renderer.root)).not.toContain('正在加载说话人')
    await act(async () => { renderer.update(<RecognizedSpeakerEntry accountKey="shared:1" active style={{}} onOpen={() => {}} directory={directory} />); await flush() })
    expect(text(renderer.root)).toContain('已识别说话人3')
    expect(source.page).toHaveBeenCalledOnce()
    expect(source.marked).toHaveBeenCalledOnce()
    await act(async () => { renderer.unmount() }); directory.clear()
  })

  it('automatically resumes a rate-limited list after cooldown and retains loaded rows meanwhile', async () => {
    vi.useFakeTimers()
    let limited = true
    const source = { marked: vi.fn(async () => [person('me')]), page: vi.fn(async (cursor: string) => {
      if (cursor === '') return { ...page(['1']), total: 2, hasMore: true, nextCursor: 'next' }
      if (limited) throw new Error('HTTP 429')
      return page(['2'])
    }), presence: vi.fn(async () => ({ state: 'fresh' as const, scope: 'all-history' as const, items: [] })) }
    const directory = new RecognizedSpeakerDirectory(source, 0)
    let renderer!: ReactTestRenderer
    await act(async () => { renderer = create(<ArkmeRecognizedSpeakersSurface accountKey="shared:2" onBack={() => {}} directory={directory} />); await flush() })
    expect(renderer.root.findAllByProps({ className: 'arkme-recognized-speakers-row' })).toHaveLength(2)
    expect(text(renderer.root)).toContain('429')
    limited = false
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); await flush() })
    expect(renderer.root.findAllByProps({ className: 'arkme-recognized-speakers-row' })).toHaveLength(3)
    expect(text(renderer.root)).not.toContain('429')
    expect(source.page.mock.calls.map(call => call[0])).toEqual(['', 'next', 'next'])
    await act(async () => { renderer.unmount() }); directory.clear()
  })

  it('shows deduplicated total and locally new identities on a second line', async () => {
    recognizedSpeakerTracker.observe('entry:a', [person('a')], [row('1')], true)
    let renderer!: ReactTestRenderer
    const open = vi.fn()
    await act(async () => { renderer = create(<RecognizedSpeakerEntry accountKey="entry:a" active style={{}} onOpen={open}
      readMarked={async () => [person('a'), person('b')]} readPage={async () => page(['1', '2'])} />); await flush() })
    try {
      // A recently visited snapshot is reused without rescanning; force a background reconciliation.
      recognizedSpeakerTracker.observe('entry:a', [person('a'), person('b')], [row('1'), row('2')])
      await act(async () => { await flush() })
      expect(text(renderer.root)).toContain('已识别说话人3')
      expect(text(renderer.root)).toContain('新识别 1 个')
      await act(async () => { renderer.root.findByType('button').props.onClick() })
      expect(open).toHaveBeenCalledOnce()
      expect(recognizedSpeakerTracker.get('entry:a').newCount).toBe(1) // Only a successful list view acknowledges.
      await act(async () => { recognizedSpeakerTracker.acknowledge('entry:a') })
      expect(text(renderer.root)).not.toContain('新识别')
    } finally { await act(async () => { renderer.unmount() }) }
  })
  it('shows no fake zero on failure and no historical new count on first use', async () => {
    let renderer!: ReactTestRenderer
    await act(async () => { renderer = create(<RecognizedSpeakerEntry accountKey="entry:new" active style={{}} onOpen={() => {}}
      readMarked={async () => [person('a'), person('b')]} readPage={async () => page(['1', '2'])} />); await flush() })
    expect(text(renderer.root)).toBe('已识别说话人3')
    await act(async () => { renderer.unmount() })
    await act(async () => { renderer = create(<RecognizedSpeakerEntry accountKey="entry:failure" active style={{}} onOpen={() => {}}
      readMarked={async () => { throw new Error('offline') }} readPage={async () => page([])} />); await flush() })
    expect(text(renderer.root)).toBe('已识别说话人')
    await act(async () => { renderer.unmount() })
  })
  it('does not let an old account response update the next account', async () => {
    let resolve!: (value: ArkmeDirectoryPage) => void
    let renderer!: ReactTestRenderer
    const readMarked = async () => []
    await act(async () => { renderer = create(<RecognizedSpeakerEntry accountKey="entry:old" active style={{}} onOpen={() => {}}
      readMarked={readMarked} readPage={async () => await new Promise(done => { resolve = done })} />); await flush() })
    await act(async () => { renderer.update(<RecognizedSpeakerEntry accountKey="entry:next" active style={{}} onOpen={() => {}}
      readMarked={readMarked} readPage={async () => page([])} />); await flush() })
    await act(async () => { resolve(page(['old'])); await flush() })
    expect(text(renderer.root)).toBe('已识别说话人0')
    expect(recognizedSpeakerTracker.get('entry:old').total).toBeUndefined()
    await act(async () => { renderer.unmount() })
  })
  it('shows the server total but no precise new count on an incomplete traversal', async () => {
    let renderer!: ReactTestRenderer
    await act(async () => { renderer = create(<RecognizedSpeakerEntry accountKey="entry:partial" active style={{}} onOpen={() => {}}
      readMarked={async () => [person('a')]} readPage={async () => ({ ...page(['1']), total: 20, hasMore: true })} />); await flush() })
    expect(text(renderer.root)).toBe('已识别说话人21')
    expect(recognizedSpeakerTracker.get('entry:partial').newCount).toBeUndefined()
    await act(async () => { renderer.unmount() })
  })
})

describe('my voice guidance', () => {
  const voiceprint = (extra: Partial<ArkmeMyVoiceprint> = {}) => ({ hasVoiceprint: false, enrollmentPending: false, ...extra }) as ArkmeMyVoiceprint
  it.each([
    [voiceprint(), '还没有标记你的声音', '录入我的声纹'],
    [voiceprint({ hasVoiceprint: true }), '已录入声纹，暂未在录音中匹配到你', '管理声纹'],
    [voiceprint({ enrollmentPending: true }), '你的声纹正在处理中', '管理声纹'],
  ])('uses the actual voiceprint state and existing safe entrypoints', async (value, title, action) => {
    let renderer!: ReactTestRenderer
    const back = vi.fn(), manage = vi.spyOn(arkmeUi, 'showVoiceprint').mockImplementation(() => {})
    await act(async () => { renderer = create(<SpeakerSelfGuide onOpenRecordings={back} readVoiceprint={async () => value} />); await flush() })
    expect(text(renderer.root)).toContain(title)
    await act(async () => { renderer.root.findAllByType('button').find(button => text(button) === '从录音中标记我')!.props.onClick() })
    expect(back).toHaveBeenCalledOnce()
    await act(async () => { renderer.root.findAllByType('button').find(button => text(button) === action)!.props.onClick() })
    expect(manage).toHaveBeenCalledOnce()
    await act(async () => { renderer.unmount() })
  })
  it('does not misreport a failed status request as missing voiceprint', async () => {
    let renderer!: ReactTestRenderer
    await act(async () => { renderer = create(<SpeakerSelfGuide onOpenRecordings={() => {}} readVoiceprint={async () => { throw new Error('offline') }} />); await flush() })
    expect(text(renderer.root)).toContain('管理声纹')
    expect(text(renderer.root)).not.toContain('录入我的声纹')
    await act(async () => { renderer.unmount() })
  })
})
