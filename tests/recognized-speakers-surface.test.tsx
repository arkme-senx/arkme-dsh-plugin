import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { describe, expect, it, vi } from 'vitest'
import type { ArkmeDirectoryPage, ArkmeRecordingSpeakerCandidate, ArkmeRecordingSpeakerPresence } from '../src/types.js'
import { ArkmeRecognizedSpeakersSurface, identifiedSpeakerRows } from '../src/client/ArkmeRecognizedSpeakersSurface.js'
import { UnmarkedSpeakerDetail } from '../src/client/redesign/contacts/UnmarkedSpeakerDetail.js'
import { arkmeUi } from '../src/client/ui-controller.js'
import { recognizedSpeakerTracker } from '../src/client/recognized-speaker-tracker.js'

const marked = (optionKey: string, label: string, personKey?: string): ArkmeRecordingSpeakerCandidate => ({
  kind: 'speaker', optionKey, speakerRef: `speaker-${optionKey}`, label, isCurrentUser: false,
  ...(personKey === undefined ? {} : { personKey }),
})
const unmarked = (candidateRef: string, speakerToken: string): Extract<ArkmeDirectoryPage['items'][number], { kind: 'unmarked-speaker' }> => ({
  kind: 'unmarked-speaker', candidateRef, speakerToken, displayName: `候选 ${speakerToken}`, subtitle: '出现 2 天',
})
const page = (items: ArkmeDirectoryPage['items'], nextCursor = ''): ArkmeDirectoryPage => ({
  section: 'unmarked-speakers', items, total: items.length, hasMore: nextCursor !== '', ...(nextCursor === '' ? {} : { nextCursor }),
})
const flush = async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve() }
const text = (node: ReactTestInstance): string => node.children.map(child => typeof child === 'string' ? child : text(child)).join('')

describe('recording speaker directory', () => {
  it('pins my verified identity in both orders, preserves filters and acknowledges the loaded directory', async () => {
    const loadMarked = async () => [marked('other', '经常的人'), { ...marked('self', '本人'), isCurrentUser: true }]
    const candidate = { ...unmarked('u', '12'), identityKey: 'stable-u', appearanceDays: 100, latestAtMillis: 900 }
    recognizedSpeakerTracker.observe('pin:1', await loadMarked(), [], true)
    recognizedSpeakerTracker.observe('pin:1', await loadMarked(), [candidate])
    expect(recognizedSpeakerTracker.get('pin:1').newCount).toBe(1)
    let renderer!: ReactTestRenderer
    await act(async () => { renderer = create(<ArkmeRecognizedSpeakersSurface accountKey="pin:1" onBack={() => {}} loadMarked={loadMarked}
      loadPresence={async () => ({ state: 'fresh', scope: 'all-history', items: [{ optionKey: 'other', dayCount: 100, lastSeenAt: 1000 }, { optionKey: 'self', dayCount: 1, lastSeenAt: 10 }] })}
      loadUnmarked={async () => page([candidate])} />); await flush() })
    const rows = () => renderer.root.findAllByProps({ className: 'arkme-recognized-speakers-row' }).map(text)
    try {
      expect(rows()[0]).toContain('本人 · 我')
      expect(text(renderer.root)).not.toContain('还没有标记你的声音')
      expect(recognizedSpeakerTracker.get('pin:1').newCount).toBe(0)
      await act(async () => { renderer.root.findByType('select').props.onChange({ target: { value: 'recent' } }) })
      expect(rows()[0]).toContain('本人 · 我')
      await act(async () => { renderer.root.findAllByType('button').find(button => text(button) === '未标记')!.props.onClick() })
      expect(rows()).toHaveLength(1)
      expect(rows()[0]).toContain('说话人 12')
    } finally { await act(async () => { renderer.unmount() }) }
  })
  it('mixes marked and unmarked speakers, changes order without fetching again and keeps it across filters', async () => {
    const loadMarked = vi.fn(async () => [marked('many', '经常的人'), marked('recent', '最近的人')])
    const loadPresence = vi.fn(async (): Promise<ArkmeRecordingSpeakerPresence> => ({ state: 'fresh', scope: 'all-history', items: [
      { optionKey: 'many', dayCount: 8, lastSeenAt: 100 }, { optionKey: 'recent', dayCount: 1, lastSeenAt: 300 },
    ] }))
    const loadUnmarked = vi.fn(async () => page([{ ...unmarked('u', '12'), appearanceDays: 8, latestAtMillis: 200 }]))
    let renderer!: ReactTestRenderer
    await act(async () => { renderer = create(<ArkmeRecognizedSpeakersSurface accountKey="sort:1" onBack={() => {}} loadMarked={loadMarked} loadPresence={loadPresence} loadUnmarked={loadUnmarked} />); await flush() })
    const rows = () => renderer.root.findAllByProps({ className: 'arkme-recognized-speakers-row' }).map(text)
    try {
      expect(renderer.root.findByType('select').props.value).toBe('frequent')
      expect(rows()[0]).toContain('说话人 12')
      expect(rows()[1]).toContain('经常的人')
      await act(async () => { renderer.root.findByType('select').props.onChange({ target: { value: 'recent' } }) })
      expect(rows()[0]).toContain('最近的人')
      expect(rows()[1]).toContain('说话人 12')
      await act(async () => { renderer.root.findAllByType('button').find(button => text(button) === '已标记')!.props.onClick() })
      expect(rows()).toHaveLength(2)
      expect(rows()[0]).toContain('最近的人')
      await act(async () => { renderer.root.findByType('input').props.onChange({ target: { value: '经常' } }) })
      expect(rows()).toHaveLength(1)
      expect(renderer.root.findByType('select').props.value).toBe('recent')
      expect(loadUnmarked).toHaveBeenCalledTimes(1)
      expect(loadMarked).toHaveBeenCalledTimes(1)
      expect(loadPresence).toHaveBeenCalledTimes(1)
    } finally { await act(async () => { renderer.unmount() }) }
  })

  it('brings a recent speaker from a later page to the top and explicitly labels partial loading', async () => {
    let finish!: (value: ArkmeDirectoryPage) => void
    const loadUnmarked = vi.fn(async (cursor: string) => cursor === ''
      ? page([{ ...unmarked('old', '1'), appearanceDays: 5, latestAtMillis: 100 }], 'next')
      : await new Promise<ArkmeDirectoryPage>(resolve => { finish = resolve }))
    let renderer!: ReactTestRenderer
    await act(async () => { renderer = create(<ArkmeRecognizedSpeakersSurface accountKey="sort:2" onBack={() => {}} loadMarked={async () => []} loadPresence={async () => ({ state: 'fresh', scope: 'all-history', items: [] })} loadUnmarked={loadUnmarked} />); await flush() })
    try {
      expect(text(renderer.root)).toContain('排序仍在更新')
      await act(async () => { renderer.root.findByType('select').props.onChange({ target: { value: 'recent' } }) })
      await act(async () => { finish(page([{ ...unmarked('new', '2'), appearanceDays: 1, latestAtMillis: 300 }])); await flush() })
      expect(text(renderer.root.findAllByProps({ className: 'arkme-recognized-speakers-row' })[0]!)).toContain('说话人 2')
      expect(text(renderer.root)).not.toContain('排序仍在更新')
      expect(text(renderer.root)).not.toContain('列表尚未完整')
    } finally { await act(async () => { renderer.unmount() }) }
  })

  it('preserves loaded rows but never labels failed later pages as fully sorted', async () => {
    const loadUnmarked = vi.fn(async (cursor: string) => {
      if (cursor !== '') throw new Error('offline')
      return page([unmarked('u', '12')], 'next')
    })
    let renderer!: ReactTestRenderer
    await act(async () => { renderer = create(<ArkmeRecognizedSpeakersSurface accountKey="sort:3" onBack={() => {}} loadMarked={async () => []} loadPresence={async () => ({ state: 'fresh', scope: 'all-history', items: [] })} loadUnmarked={loadUnmarked} />); await flush() })
    try {
      expect(text(renderer.root)).toContain('说话人 12')
      expect(text(renderer.root)).toContain('列表尚未完整')
      expect(text(renderer.root)).toContain('offline')
    } finally { await act(async () => { renderer.unmount() }) }
  })

  it('limits rendering rather than searching or sorting to the first display page', async () => {
    let renderer!: ReactTestRenderer
    await act(async () => { renderer = create(<ArkmeRecognizedSpeakersSurface accountKey="sort:4" onBack={() => {}}
      loadMarked={async () => Array.from({ length: 105 }, (_, i) => marked(String(i), `人物 ${i}`))}
      loadPresence={async () => ({ state: 'fresh', scope: 'all-history', items: [] })} loadUnmarked={async () => page([])} />); await flush() })
    try {
      expect(renderer.root.findAllByProps({ className: 'arkme-recognized-speakers-row' })).toHaveLength(100)
      await act(async () => { renderer.root.findAllByType('button').find(button => text(button) === '显示更多说话人')!.props.onClick() })
      expect(renderer.root.findAllByProps({ className: 'arkme-recognized-speakers-row' })).toHaveLength(105)
      await act(async () => { renderer.root.findByType('input').props.onChange({ target: { value: '人物 104' } }) })
      expect(renderer.root.findAllByProps({ className: 'arkme-recognized-speakers-row' })).toHaveLength(1)
    } finally { await act(async () => { renderer.unmount() }) }
  })

  it('returns to the selected recording day after opening the speaker directory', () => {
    const selectedDay = new Date(2026, 8, 20).getTime()
    arkmeUi.showRecognizedSpeakers(selectedDay)
    expect(arkmeUi.getSnapshot().mode).toBe('recognized-speakers')
    expect(arkmeUi.getSnapshot().recordingReturnDateStamp).toBe(selectedDay)
    arkmeUi.showRecordingTarget(selectedDay, selectedDay)
    expect(arkmeUi.getSnapshot().recordingTarget?.dateStamp).toBe(selectedDay)
    expect(arkmeUi.getSnapshot().recordingReturnDateStamp).toBeUndefined()
  })

  it('groups marked records by bound person and keeps same-name or same-number strangers separate', () => {
    const rows = identifiedSpeakerRows([
      marked('a1', '周鹏', 'person-a'), marked('a2', '周鹏', 'person-a'),
      marked('b1', '周鹏'), marked('b2', '周鹏'),
      { ...marked('candidate-user', '另一位'), kind: 'arkme-user' },
    ], [unmarked('candidate-1', '12'), unmarked('candidate-2', '12')])
    expect(rows.filter(row => row.kind === 'marked')).toHaveLength(3)
    expect(rows.filter(row => row.kind === 'unmarked')).toHaveLength(2)
    expect(rows.filter(row => row.kind === 'unmarked').map(row => row.key)).toEqual(['candidate-1', 'candidate-2'])
  })

  it('loads both sources, paginates candidates, filters, and refreshes after a mark', async () => {
    const loadMarked = vi.fn(async () => [marked('a1', '周鹏')])
    const loadPresence = vi.fn(async (): Promise<ArkmeRecordingSpeakerPresence> => ({ state: 'fresh', scope: 'all-history', items: [{ optionKey: 'a1', dayCount: 3, lastSeenAt: new Date(2026, 8, 20, 16, 30).getTime() }] }))
    const loadUnmarked = vi.fn(async (cursor: string) => cursor === ''
      ? page([unmarked('candidate-1', '12')], 'next')
      : page([unmarked('candidate-2', '27')]))
    let renderer!: ReactTestRenderer
    await act(async () => { renderer = create(<ArkmeRecognizedSpeakersSurface accountKey="prod:1" onBack={() => {}} loadMarked={loadMarked} loadPresence={loadPresence} loadUnmarked={loadUnmarked} />); await flush() })
    try {
      expect(text(renderer.root)).toContain('周鹏')
      expect(text(renderer.root)).toContain('出现 3 天 · 最近')
      expect(text(renderer.root)).toContain('说话人 12')
      expect(loadUnmarked).toHaveBeenCalledWith('next', expect.any(AbortSignal))
      expect(text(renderer.root)).toContain('说话人 27')
      await act(async () => { renderer.root.findAllByType('button').find(button => text(button) === '已标记')?.props.onClick() })
      expect(renderer.root.findAllByProps({ className: 'arkme-recognized-speakers-row' })).toHaveLength(1)
      await act(async () => { renderer.root.findAllByType('button').find(button => text(button) === '未标记')?.props.onClick() })
      const speaker = renderer.root.findAllByProps({ className: 'arkme-recognized-speakers-row' })[0]
      await act(async () => { speaker!.props.onClick(); await flush() })
      const detail = renderer.root.findByType(UnmarkedSpeakerDetail)
      await act(async () => { detail.props.onDirectoryRefresh(); await flush() })
      expect(loadMarked).toHaveBeenCalledTimes(2)
      expect(loadPresence).toHaveBeenCalledTimes(2)
      expect(loadUnmarked).toHaveBeenCalledTimes(4)
    } finally {
      await act(async () => { renderer.unmount() })
    }
  })

  it('opens a labeled person and shows only verified full-history source voices', async () => {
    const loadMarkedMembers = vi.fn(async () => ({
      state: 'fresh' as const, scope: 'all-history' as const, dayCount: 2, lastSeenAt: new Date(2026, 8, 21).getTime(),
      items: [
        { identityKey: 'original-12', token: '12', dayCount: 2, lastSeenAt: new Date(2026, 8, 21).getTime() },
        { identityKey: 'original-a', token: 'A', dayCount: 1, lastSeenAt: new Date(2026, 8, 20).getTime() },
      ],
    }))
    let renderer!: ReactTestRenderer
    await act(async () => { renderer = create(<ArkmeRecognizedSpeakersSurface accountKey="prod:1" onBack={() => {}}
      loadMarked={async () => [marked('a1', '周鹏')]}
      loadPresence={async () => ({ state: 'fresh', scope: 'all-history', items: [] })}
      loadMarkedMembers={loadMarkedMembers} loadUnmarked={async () => page([])} />); await flush() })
    try {
      const speaker = renderer.root.findAllByProps({ className: 'arkme-recognized-speakers-row' })[0]!
      await act(async () => { speaker.props.onClick(); await flush() })
      expect(loadMarkedMembers).toHaveBeenCalledWith('speaker-a1', expect.any(AbortSignal), undefined)
      expect(text(renderer.root)).toContain('对应的识别说话人')
      expect(text(renderer.root)).toContain('说话人 12')
      expect(text(renderer.root)).toContain('说话人 A')
      expect(text(renderer.root)).toContain('全部历史')
    } finally { await act(async () => { renderer.unmount() }) }
  })

  it('does not invent a day count while the presence projection is still building', async () => {
    let renderer!: ReactTestRenderer
    await act(async () => { renderer = create(<ArkmeRecognizedSpeakersSurface accountKey="prod:1" onBack={() => {}}
      loadMarked={async () => [marked('a1', '周鹏')]}
      loadPresence={async () => ({ state: 'building', scope: 'all-history', items: [], retryAfterMs: 60_000 })}
      loadUnmarked={async () => page([])} />); await flush() })
    try {
      expect(text(renderer.root)).toContain('出现统计整理中')
      expect(text(renderer.root)).not.toContain('出现 0 天')
    } finally { await act(async () => { renderer.unmount() }) }
  })

  it('does not display old counts as current while stale', async () => {
    let renderer!: ReactTestRenderer
    await act(async () => { renderer = create(<ArkmeRecognizedSpeakersSurface accountKey="prod:1" onBack={() => {}}
      loadMarked={async () => [marked('a1', '周鹏')]}
      loadPresence={async () => ({ state: 'stale', scope: 'all-history', items: [{ optionKey: 'a1', dayCount: 99, lastSeenAt: 1780000000000 }], retryAfterMs: 60000 })}
      loadUnmarked={async () => page([])} />); await flush() })
    try {
      expect(text(renderer.root)).toContain('出现统计更新中')
      expect(text(renderer.root)).not.toContain('出现 99 天')
    } finally { await act(async () => { renderer.unmount() }) }
  })
  it('polls a changed detail version, adopts the refreshed list version and cancels on unmount', async () => {
    vi.useFakeTimers()
    const signals: AbortSignal[] = []
    const loadPresence = vi.fn(async (): Promise<ArkmeRecordingSpeakerPresence> => ({ state: 'fresh', scope: 'all-history', version: 'v2', items: [] }))
    loadPresence.mockResolvedValueOnce({ state: 'fresh', scope: 'all-history', version: 'v1', items: [] })
    const loadMembers = vi.fn(async (_ref: string, signal: AbortSignal, version?: string) => {
      signals.push(signal)
      return { state: version === 'v2' ? 'fresh' as const : 'stale' as const, scope: 'all-history' as const, version: 'v2', dayCount: 0, lastSeenAt: 0, items: [], retryAfterMs: 1000 }
    })
    let renderer!: ReactTestRenderer
    try {
      await act(async () => { renderer = create(<ArkmeRecognizedSpeakersSurface accountKey="prod:1" onBack={() => {}}
        loadMarked={async () => [marked('a1', '周鹏')]} loadPresence={loadPresence}
        loadMarkedMembers={loadMembers} loadUnmarked={async () => page([])} />); await flush() })
      await act(async () => { renderer.root.findAllByProps({ className: 'arkme-recognized-speakers-row' })[0]!.props.onClick(); await flush() })
      expect(text(renderer.root)).toContain('出现统计更新中')
      expect(text(renderer.root)).not.toContain('出现 0 天')
      await act(async () => { await vi.advanceTimersByTimeAsync(5000); await flush() })
      expect(loadMembers).toHaveBeenLastCalledWith('speaker-a1', expect.any(AbortSignal), 'v2')
      expect(text(renderer.root)).toContain('暂无可核实的关联说话人')
      await act(async () => { renderer.unmount() })
      const count = loadMembers.mock.calls.length
      await vi.advanceTimersByTimeAsync(60000)
      expect(loadMembers).toHaveBeenCalledTimes(count)
      expect(signals.every(signal => signal.aborted)).toBe(true)
    } finally { vi.useRealTimers() }
  })

  it('clears the previous account immediately and ignores its late list and detail responses', async () => {
    let finish!: (value: { state: 'fresh'; scope: 'all-history'; dayCount: number; lastSeenAt: number; items: [] }) => void
    let oldSignal!: AbortSignal
    const members = vi.fn((_ref: string, signal: AbortSignal) => { oldSignal = signal; return new Promise<Parameters<typeof finish>[0]>(resolve => { finish = resolve }) })
    const common = { onBack: () => {}, loadPresence: async (): Promise<ArkmeRecordingSpeakerPresence> => ({ state: 'fresh', scope: 'all-history', items: [] }), loadMarkedMembers: members, loadUnmarked: async () => page([]) }
    let renderer!: ReactTestRenderer
    await act(async () => { renderer = create(<ArkmeRecognizedSpeakersSurface {...common} accountKey="prod:1" loadMarked={async () => [marked('a1', '旧账号人物')]} />); await flush() })
    try {
      await act(async () => { renderer.root.findAllByProps({ className: 'arkme-recognized-speakers-row' })[0]!.props.onClick(); await flush() })
      await act(async () => { renderer.update(<ArkmeRecognizedSpeakersSurface {...common} accountKey="prod:2" loadMarked={() => new Promise(() => {})} />); await flush() })
      expect(oldSignal.aborted).toBe(true)
      expect(text(renderer.root)).not.toContain('旧账号人物')
      await act(async () => { finish({ state: 'fresh', scope: 'all-history', dayCount: 3, lastSeenAt: 5, items: [] }); await flush() })
      expect(text(renderer.root)).not.toContain('旧账号人物')
      expect(text(renderer.root)).not.toContain('对应的识别说话人')
    } finally { await act(async () => { renderer.unmount() }) }
  })

  it('cancels an in-flight statistics poll when manually refreshing and ignores its late failure', async () => {
    vi.useFakeTimers()
    let finishPoll!: (result: ArkmeRecordingSpeakerPresence) => void
    let finishRefresh!: (result: ArkmeRecordingSpeakerPresence) => void
    const loadPresence = vi.fn<(signal: AbortSignal) => Promise<ArkmeRecordingSpeakerPresence>>()
      .mockResolvedValueOnce({ state: 'stale', scope: 'all-history', items: [], retryAfterMs: 5000 })
      .mockImplementationOnce(() => new Promise(resolve => { finishPoll = resolve }))
      .mockImplementationOnce(() => new Promise(resolve => { finishRefresh = resolve }))
    let renderer!: ReactTestRenderer
    try {
      await act(async () => { renderer = create(<ArkmeRecognizedSpeakersSurface accountKey="prod:1" onBack={() => {}}
        loadMarked={async () => [marked('a1', '周鹏')]} loadPresence={loadPresence} loadUnmarked={async () => page([])} />); await flush() })
      await act(async () => { await vi.advanceTimersByTimeAsync(5000) })
      expect(loadPresence).toHaveBeenCalledTimes(2)
      const pollSignal = loadPresence.mock.calls[1]![0]
      await act(async () => { renderer.root.findAllByType('button').find(button => text(button) === '刷新')!.props.onClick(); await flush() })
      expect(pollSignal.aborted).toBe(true)
      await act(async () => { finishRefresh({ state: 'fresh', scope: 'all-history', items: [{ optionKey: 'a1', dayCount: 3, lastSeenAt: 1780000000000 }] }); await flush() })
      await act(async () => { finishPoll({ state: 'failed', scope: 'all-history', items: [] }); await flush() })
      expect(text(renderer.root)).toContain('出现 3 天')
      await act(async () => { await vi.advanceTimersByTimeAsync(30000) })
      expect(loadPresence).toHaveBeenCalledTimes(3)
    } finally { if (renderer) await act(async () => { renderer.unmount() }); vi.useRealTimers() }
  })

  it('ignores a late metadata page from before refresh and automatically completes the new traversal', async () => {
    let finishOld!: (value: ArkmeDirectoryPage) => void
    const loadUnmarked = vi.fn<(cursor: string, signal: AbortSignal) => Promise<ArkmeDirectoryPage>>()
      .mockResolvedValueOnce(page([], 'old-next'))
      .mockImplementationOnce(() => new Promise(resolve => { finishOld = resolve }))
      .mockResolvedValueOnce(page([unmarked('new', '1')]))
    let renderer!: ReactTestRenderer
    await act(async () => { renderer = create(<ArkmeRecognizedSpeakersSurface accountKey="prod:1" onBack={() => {}}
      loadMarked={async () => []} loadPresence={async () => ({ state: 'fresh', scope: 'all-history', items: [] })} loadUnmarked={loadUnmarked} />); await flush() })
    try {
      expect(loadUnmarked).toHaveBeenCalledTimes(2)
      await act(async () => { renderer.root.findAllByType('button').find(button => text(button) === '刷新')!.props.onClick(); await flush() })
      expect(loadUnmarked).toHaveBeenCalledTimes(3)
      await act(async () => { finishOld(page([unmarked('old', '99')])); await flush() })
      expect(loadUnmarked).toHaveBeenCalledTimes(3)
      expect(text(renderer.root)).not.toContain('说话人 99')
      expect(text(renderer.root)).toContain('说话人 1')
      expect(text(renderer.root)).not.toContain('列表尚未完整')
    } finally { await act(async () => { renderer.unmount() }) }
  })

})
