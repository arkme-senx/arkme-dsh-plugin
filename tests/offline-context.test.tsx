import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { canShareOfflineContext, confirmedOfflineContexts, offlineEvidenceRange, type OfflineContextActions, type OfflineContextEntry } from '../src/offline-context.js'
import { OfflineContextCard } from '../src/client/offline-context/OfflineContextCard.js'
import { offlineContextPreviewRequested } from '../src/client/offline-context/OfflineContextPreview.js'

const entry: OfflineContextEntry = {
  id: 'e', revision: 'v1', conversationKey: 'private:a', conversationName: '同事', conversationKind: 'private_chat',
  startAtMillis: 100, endAtMillis: 300, title: '口头回复', summary: ['需要时检查'], participants: ['你'], reason: '问题与回答对应',
  state: 'linked', visibility: 'private', sourceState: 'available', messages: [], selectedEvidenceIds: ['s1', 's2'],
  evidence: [{ id: 's1', startAtMillis: 100, endAtMillis: 200, speaker: '你', text: '第一句话', soundSource: 'in_person', transcriptRef: 'source-1' },
    { id: 's2', startAtMillis: 200, endAtMillis: 300, speaker: '你', text: '第二句话', soundSource: 'unknown' }],
}
function actions(): OfflineContextActions {
  return { change: vi.fn(async () => ({ status: 'applied' as const })), reconcile: vi.fn(async () => 'applied' as const), openMessage: vi.fn(), openTranscript: vi.fn(), play: vi.fn() }
}
function text(value: unknown): string {
  if (Array.isArray(value)) return value.map(text).join('')
  if (value && typeof value === 'object' && 'props' in value) return text((value as { props: { children?: unknown } }).props.children)
  return typeof value === 'string' ? value : ''
}
function button(renderer: ReactTestRenderer, label: string) {
  return renderer.root.findAllByType('button').find(item => text(item.props.children) === label)!
}
async function mount(transport: OfflineContextActions, patch: Partial<OfflineContextEntry> = {}) {
  let renderer!: ReactTestRenderer
  await act(async () => { renderer = create(<OfflineContextCard entry={{ ...entry, ...patch }} actions={transport} />) })
  return renderer
}

describe('offline context boundaries', () => {
  it('keeps uncertain candidates, removed links and other conversations outside confirmed history', () => {
    const result = confirmedOfflineContexts([entry, { ...entry, id: 'other', conversationKey: 'group:b' },
      { ...entry, id: 'pending', state: 'suggested' }, { ...entry, id: 'deleted', state: 'dismissed' }], 'private:a')
    expect(result.map(item => item.id)).toEqual(['e'])
    expect(confirmedOfflineContexts([entry, { ...entry, state: 'dismissed' }], 'private:a')).toEqual([])
  })
  it('never shares unconfirmed, stale, unavailable, already-shared or playback selections', () => {
    expect(canShareOfflineContext(entry)).toBe(true)
    for (const patch of [{ state: 'suggested' }, { sourceState: 'changed' }, { sourceState: 'unavailable' },
      { visibility: 'shared' }, { selectedEvidenceIds: [] }] as Partial<OfflineContextEntry>[]) {
      expect(canShareOfflineContext({ ...entry, ...patch })).toBe(false)
    }
    expect(canShareOfflineContext({ ...entry, evidence: entry.evidence.map(item => ({ ...item, soundSource: 'playback' })) })).toBe(false)
  })
  it('only selects existing contiguous source intervals', () => {
    expect(offlineEvidenceRange(entry, 's1', 's2')).toEqual(['s1', 's2'])
    expect(offlineEvidenceRange(entry, 's2', 's1')).toEqual([])
    expect(offlineEvidenceRange(entry, 'invented', 's2')).toEqual([])
  })
  it('allows the explicit preview only on loopback hosts', () => {
    expect(offlineContextPreviewRequested({ hostname: '127.0.0.1', search: '?arkme-offline-context-preview=1' })).toBe(true)
    expect(offlineContextPreviewRequested({ hostname: 'arkme.cn', search: '?arkme-offline-context-preview=1' })).toBe(false)
    expect(offlineContextPreviewRequested({ hostname: 'localhost', search: '' })).toBe(false)
  })
  it('does not fabricate playback access or a received message', () => {
    const html = renderToStaticMarkup(<OfflineContextCard entry={entry} actions={actions()} />)
    expect(html).toContain('仅你可见')
    expect(html).toContain('当前片段未提供可播放的音频')
    expect(html).not.toContain('已共享')
  })
})

describe('offline context actions', () => {
  it('previews the recipient and content before sending a version-bound action', async () => {
    const transport = actions()
    const renderer = await mount(transport)
    await act(async () => { button(renderer, '分享到此对话').props.onClick() })
    expect(transport.change).not.toHaveBeenCalled()
    expect(renderer.root.findByProps({ role: 'dialog' })).toBeTruthy()
    await act(async () => { button(renderer, '确认分享').props.onClick() })
    expect(transport.change).toHaveBeenCalledWith(expect.objectContaining({ entryId: 'e', expectedRevision: 'v1', conversationKey: 'private:a', change: { kind: 'share', includeTranscript: false } }))
    await act(async () => renderer.unmount())
  })
  it('locks duplicate clicks synchronously while a mutation is pending', async () => {
    let finish!: (value: { status: 'applied' }) => void
    const transport = actions()
    transport.change = vi.fn(() => new Promise(resolve => { finish = resolve }))
    const renderer = await mount(transport)
    await act(async () => { button(renderer, '分享到此对话').props.onClick() })
    await act(async () => { const confirm = button(renderer, '确认分享'); confirm.props.onClick(); confirm.props.onClick() })
    expect(transport.change).toHaveBeenCalledTimes(1)
    await act(async () => { finish({ status: 'applied' }) })
    await act(async () => renderer.unmount())
  })
  it.each(['receipt', 'transport'])('reconciles an ambiguous %s without automatically replaying the write', async kind => {
    const transport = actions()
    transport.change = kind === 'receipt' ? vi.fn(async () => ({ status: 'unknown' as const })) : vi.fn(async () => { throw new Error('timeout') })
    const renderer = await mount(transport)
    await act(async () => { button(renderer, '分享到此对话').props.onClick() })
    await act(async () => { button(renderer, '确认分享').props.onClick() })
    expect(button(renderer, '确认分享').props.disabled).toBe(true)
    expect(transport.change).toHaveBeenCalledTimes(1)
    await act(async () => { button(renderer, '核对状态').props.onClick() })
    expect(transport.reconcile).toHaveBeenCalledWith(expect.objectContaining({ entryId: 'e', requestId: expect.any(String) }))
    expect(transport.change).toHaveBeenCalledTimes(1)
    await act(async () => renderer.unmount())
  })
  it('passes only a host source reference when locating original speech', async () => {
    const transport = actions()
    const renderer = await mount(transport)
    await act(async () => { button(renderer, '查看原文').props.onClick() })
    const locate = renderer.root.findAllByType('button').find(item => text(item.props.children).trim() === '定位转写原文' && !item.props.disabled)!
    await act(async () => { locate.props.onClick() })
    expect(transport.openTranscript).toHaveBeenCalledWith('source-1')
    await act(async () => renderer.unmount())
  })
  it('keeps writes locked while reconciliation reports pending', async () => {
    const transport = actions()
    transport.change = vi.fn(async () => ({ status: 'unknown' as const }))
    transport.reconcile = vi.fn(async () => 'pending' as const)
    const renderer = await mount(transport)
    await act(async () => { button(renderer, '分享到此对话').props.onClick() })
    await act(async () => { button(renderer, '确认分享').props.onClick() })
    await act(async () => { button(renderer, '核对状态').props.onClick() })
    expect(button(renderer, '确认分享').props.disabled).toBe(true)
    expect(transport.change).toHaveBeenCalledTimes(1)
    await act(async () => renderer.unmount())
  })
})
