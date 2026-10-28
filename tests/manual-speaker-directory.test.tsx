import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { PersonFacet } from '../src/people-contract.js'
import type { ArkmeDirectoryItem, ArkmeRecordingSpeakerMembers } from '../src/types.js'
import { manualSpeakerDirectoryPage } from '../src/client/redesign/contacts/manual-speaker-directory.js'
import { ManualSpeakerDetail } from '../src/client/redesign/contacts/ManualSpeakerDetail.js'
import { ContactDirectorySurface, defaultLoadPage } from '../src/client/redesign/contacts/ContactDirectorySurface.js'
import { CONTACT_DIRECTORY_SECTION_ORDER, createContactDirectoryState } from '../src/client/redesign/contacts/contact-directory-state.js'

const api = vi.hoisted(() => ({ call: vi.fn() }))
vi.mock('../src/client/api.js', () => ({ callArkme: api.call }))
const facet = (key: string, changes: Partial<PersonFacet> = {}): PersonFacet => ({
  key, personKey: key, source: 'speakers', name: '安宝', aliases: [], accountLinked: false, isSelf: false, speakerRef: `ref-${key}`, ...changes,
})
const speaker = (key: string): Extract<ArkmeDirectoryItem, { kind: 'manual-speaker' }> => ({
  kind: 'manual-speaker', speakerKey: key, speakerRef: `ref-${key}`, displayName: key,
})
const stats = (token = '31'): ArkmeRecordingSpeakerMembers => ({
  state: 'fresh', scope: 'all-history', dayCount: 3, lastSeenAt: 1792728000000,
  items: [{ identityKey: token, token, dayCount: 2, lastSeenAt: 1792728000000 }],
})
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(yes => { resolve = yes })
  return { promise, resolve }
}
const mounted: ReactTestRenderer[] = []
async function mount(element: React.ReactElement) {
  let renderer!: ReactTestRenderer
  await act(async () => { renderer = create(element) })
  mounted.push(renderer)
  return renderer
}
const text = (renderer: ReactTestRenderer) => JSON.stringify(renderer.toJSON())
afterEach(() => { act(() => { mounted.splice(0).forEach(renderer => renderer.unmount()) }); vi.clearAllMocks() })

describe('manual speaker directory', () => {
  it('keeps distinct same-name identities and includes speakers without recording statistics', () => {
    const page = manualSpeakerDirectoryPage({ source: 'speakers', items: [facet('a'), facet('b'), facet('a'), facet('self', { isSelf: true }), facet('contact', { accountLinked: true })] })
    expect(page.total).toBe(2)
    expect(page.items.map(item => item.kind === 'manual-speaker' && item.speakerKey)).toEqual(['a', 'b'])
    expect(page.hasMore).toBe(false)
  })
  it('does not misrepresent incomplete, wrong-source or invalid data as an empty directory', () => {
    for (const value of [{}, { source: 'contacts', items: [] }, { source: 'speakers', items: [facet('a', { speakerRef: undefined })] }, { source: 'speakers', items: [], nextCursor: 'more' }]) {
      expect(() => manualSpeakerDirectoryPage(value)).toThrow('说话人名单读取不完整')
    }
  })
  it('uses the existing owner-scoped names query independently of recording statistics', async () => {
    api.call.mockResolvedValue({ source: 'speakers', items: [facet('a')] })
    const signal = new AbortController().signal
    expect((await defaultLoadPage('manual-speakers', { limit: 50 }, signal)).total).toBe(1)
    expect(api.call).toHaveBeenCalledExactlyOnceWith('people.list', { source: 'speakers' }, signal)
  })
  it('refreshes names on returning from recording even when the Contacts cache is fresh', async () => {
    const state = createContactDirectoryState('account-a')
    for (const kind of CONTACT_DIRECTORY_SECTION_ORDER) Object.assign(state.sections[kind], { status: 'ready' })
    Object.assign(state.sections['manual-speakers'], { expanded: true, total: 1, items: [speaker('old')] })
    state.selection = speaker('old')
    const result = deferred<ReturnType<typeof manualSpeakerDirectoryPage>>()
    const loadPage = vi.fn(() => result.promise), onSelectionChange = vi.fn()
    const props = { accountKey: 'account-a', initialState: state, cacheFresh: true, loadPage, onSelectionChange, onOpenGroup: vi.fn(), onOpenBot: vi.fn() }
    const renderer = await mount(<ContactDirectorySurface {...props} active={false}/>)
    await act(async () => { renderer.update(<ContactDirectorySurface {...props} active/>) })
    expect(loadPage).toHaveBeenCalledTimes(1)
    expect(loadPage.mock.calls[0]?.[0]).toBe('manual-speakers')
    expect(renderer.root.findByProps({ 'data-directory-row-ref': 'old' })).toBeDefined()
    await act(async () => { result.resolve({ section: 'manual-speakers', items: [{ ...speaker('old'), speakerRef: 'renewed' }, speaker('new')], total: 2, hasMore: false }) })
    expect(renderer.root.findByProps({ 'data-directory-row-ref': 'new' })).toBeDefined()
    expect(onSelectionChange).toHaveBeenLastCalledWith({ ...speaker('old'), speakerRef: 'renewed' })
  })
})

describe('manual speaker details', () => {
  it('shows identity immediately, then recording evidence with exact timestamp navigation', async () => {
    const result = deferred<ArkmeRecordingSpeakerMembers>(), open = vi.fn()
    const renderer = await mount(<ManualSpeakerDetail accountKey="a" speaker={speaker('安宝')} load={() => result.promise} onOpenRecording={open}/>)
    expect(text(renderer)).toContain('安宝')
    expect(text(renderer)).toContain('正在读取录音出现记录')
    expect(text(renderer)).not.toContain('出现 0 天')
    await act(async () => { result.resolve(stats()) })
    expect(text(renderer)).toContain('出现 3 天')
    await act(async () => { renderer.root.findByProps({ 'aria-label': '查看说话人 31 的最近录音' }).props.onClick() })
    expect(open).toHaveBeenCalledWith(stats().lastSeenAt)
  })
  it('aborts stale details across both person changes and account changes', async () => {
    const pending = [deferred<ArkmeRecordingSpeakerMembers>(), deferred<ArkmeRecordingSpeakerMembers>(), deferred<ArkmeRecordingSpeakerMembers>()]
    const signals: AbortSignal[] = []
    const load = vi.fn((_ref: string, signal: AbortSignal) => { signals.push(signal); return pending[signals.length - 1]!.promise })
    const renderer = await mount(<ManualSpeakerDetail accountKey="a" speaker={speaker('one')} load={load}/>)
    await act(async () => { renderer.update(<ManualSpeakerDetail accountKey="a" speaker={speaker('two')} load={load}/>) })
    expect(signals[0]?.aborted).toBe(true)
    await act(async () => { renderer.update(<ManualSpeakerDetail accountKey="b" speaker={speaker('two')} load={load}/>) })
    expect(signals[1]?.aborted).toBe(true)
    await act(async () => { pending[2]!.resolve(stats('33')); pending[0]!.resolve(stats('11')); pending[1]!.resolve(stats('22')) })
    expect(text(renderer)).toContain('说话人 33')
    expect(text(renderer)).not.toContain('说话人 11')
    expect(text(renderer)).not.toContain('说话人 22')
  })
  it('keeps the speaker visible after a statistics failure and supports retry', async () => {
    const load = vi.fn().mockRejectedValueOnce(new Error('网络暂时不可用')).mockResolvedValueOnce({ ...stats(), items: [], dayCount: 0, lastSeenAt: 0 })
    const renderer = await mount(<ManualSpeakerDetail accountKey="a" speaker={speaker('安宝')} load={load}/>)
    expect(text(renderer)).toContain('安宝')
    expect(text(renderer)).toContain('网络暂时不可用')
    await act(async () => { renderer.root.findAllByType('button')[0]!.props.onClick() })
    expect(text(renderer)).toContain('已创建的说话人仍会保留在名单中')
    expect(load).toHaveBeenCalledTimes(2)
  })
})
