import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { describe, expect, it, vi } from 'vitest'
import type { ArkmeDirectoryPage, ArkmeRecordingSpeakerCandidate, ArkmeRecordingSpeakerPresence } from '../src/types.js'
import { ArkmeRecognizedSpeakersSurface, identifiedSpeakerRows } from '../src/client/ArkmeRecognizedSpeakersSurface.js'
import { UnmarkedSpeakerDetail } from '../src/client/redesign/contacts/UnmarkedSpeakerDetail.js'
import { arkmeUi } from '../src/client/ui-controller.js'

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
      await act(async () => { renderer.root.findAllByType('button').find(button => text(button) === '加载更多未标记说话人')?.props.onClick(); await flush() })
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
      expect(loadUnmarked).toHaveBeenCalledTimes(3)
    } finally {
      await act(async () => { renderer.unmount() })
    }
  })

  it('opens a labeled person and shows only verified recent source voices', async () => {
    const loadMarkedMembers = vi.fn(async () => ({
      scope: 'recent-seven-days' as const, dayCount: 2, lastSeenAt: new Date(2026, 8, 21).getTime(),
      items: [
        { token: '12', dayCount: 2, lastSeenAt: new Date(2026, 8, 21).getTime() },
        { token: 'A', dayCount: 1, lastSeenAt: new Date(2026, 8, 20).getTime() },
      ],
    }))
    let renderer!: ReactTestRenderer
    await act(async () => { renderer = create(<ArkmeRecognizedSpeakersSurface accountKey="prod:1" onBack={() => {}}
      loadMarked={async () => [marked('a1', '周鹏')]}
      loadPresence={async () => ({ state: 'fresh', scope: 'recent-seven-days', items: [] })}
      loadMarkedMembers={loadMarkedMembers} loadUnmarked={async () => page([])} />); await flush() })
    try {
      const speaker = renderer.root.findAllByProps({ className: 'arkme-recognized-speakers-row' })[0]!
      await act(async () => { speaker.props.onClick(); await flush() })
      expect(loadMarkedMembers).toHaveBeenCalledWith('speaker-a1', expect.any(AbortSignal))
      expect(text(renderer.root)).toContain('对应的识别说话人')
      expect(text(renderer.root)).toContain('说话人 12')
      expect(text(renderer.root)).toContain('说话人 A')
      expect(text(renderer.root)).toContain('完整历史待接口')
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

  it('labels a recent fallback clearly instead of presenting it as all-history', async () => {
    let renderer!: ReactTestRenderer
    await act(async () => { renderer = create(<ArkmeRecognizedSpeakersSurface accountKey="prod:1" onBack={() => {}}
      loadMarked={async () => [marked('a1', '周鹏'), marked('a2', '李四')]}
      loadPresence={async () => ({ state: 'fresh', scope: 'recent-seven-days', items: [{ optionKey: 'a1', dayCount: 2, lastSeenAt: new Date(2026, 8, 20, 16, 30).getTime() }] })}
      loadUnmarked={async () => page([])} />); await flush() })
    try {
      expect(text(renderer.root)).toContain('近 7 天出现 2 天 · 最近')
      expect(text(renderer.root)).toContain('近 7 天未见已转写发声 · 全历史待接口')
      expect(text(renderer.root)).toContain('已标记项仅统计近 7 天已转写发声')
    } finally { await act(async () => { renderer.unmount() }) }
  })
})
