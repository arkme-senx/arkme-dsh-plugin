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
  return { preview: vi.fn(async () => ({ previewRef: 'frozen', title: entry.title, summary: entry.summary.join('\n'), transcript: [], expiresAtMillis: Date.now() + 300000 })), change: vi.fn(async () => ({ status: 'applied' as const })), reconcile: vi.fn(async () => 'applied' as const), openMessage: vi.fn(), openTranscript: vi.fn(), play: vi.fn() }
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
  it('does not offer confirmation before a changed selection has a new summary', async () => {
    const renderer = await mount(actions(), { state: 'suggested', summary: [], title: '' })
    expect(button(renderer, '是这次交流').props.disabled).toBe(true)
    expect(renderer.root.findAllByProps({ role: 'status' }).some(node => text(node.props.children).includes('摘要尚待重新核对'))).toBe(true)
    await act(async () => renderer.unmount())
  })
  it('previews the recipient and content before sending a version-bound action', async () => {
    const transport = actions()
    const renderer = await mount(transport)
    await act(async () => { button(renderer, '分享到此对话').props.onClick() })
    expect(transport.change).not.toHaveBeenCalled()
    expect(renderer.root.findByProps({ role: 'dialog' })).toBeTruthy()
    await act(async () => { button(renderer, '确认分享').props.onClick() })
    expect(transport.change).toHaveBeenCalledWith(expect.objectContaining({ entryId: 'e', expectedRevision: 'v1', conversationKey: 'private:a', change: { kind: 'share', includeTranscript: false, previewRef: 'frozen' } }))
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

it('keeps the original from/to selection while submitting fresh source references', async () => {
  const transport = actions()
  transport.rangeOptions = vi.fn(async () => ({ revision: entry.revision, selectedEvidenceIds: ['fresh-1', 'fresh-2'], evidence: [
    { ...entry.evidence[0]!, id: 'fresh-1', text: '甲🙂乙丙' },
    { ...entry.evidence[1]!, id: 'fresh-2' },
  ] }))
  const renderer = await mount(transport)
  await act(async () => renderer.root.findByProps({ 'aria-label': '线下交流更多操作' }).props.onClick())
  await act(async () => button(renderer, '调整录音范围').props.onClick())
  expect(transport.rangeOptions).toHaveBeenCalled()
  expect(renderer.root.findAllByType('input').filter(node => node.props.type === 'number')).toHaveLength(0)
  const [from, to] = renderer.root.findAllByType('select')
  await act(async () => { from!.props.onChange({ target: { value: 'fresh-2' } }); to!.props.onChange({ target: { value: 'fresh-1' } }) })
  expect(button(renderer, '保存').props.disabled).toBe(true)
  expect(transport.change).not.toHaveBeenCalled()
  await act(async () => { from!.props.onChange({ target: { value: 'fresh-1' } }) })
  await act(async () => button(renderer, '保存').props.onClick())
  expect(transport.change).toHaveBeenCalledWith(expect.objectContaining({ change: { kind: 'range', evidenceIds: ['fresh-1'] } }))
  await act(async () => renderer.unmount())
})

it('keeps withdrawal in the existing more menu and requires confirmation without removing the private association', async () => {
  const transport = actions()
  const renderer = await mount(transport, { hasSharedSnapshot: true })
  expect(button(renderer, '撤回已分享消息')).toBeUndefined()
  await act(async () => renderer.root.findByProps({ 'aria-label': '线下交流更多操作' }).props.onClick())
  await act(async () => button(renderer, '撤回已分享消息').props.onClick())
  expect(transport.change).not.toHaveBeenCalled()
  await act(async () => button(renderer, '确认撤回').props.onClick())
  expect(transport.change).toHaveBeenCalledWith(expect.objectContaining({ change: { kind: 'withdraw' } }))
  await act(async () => renderer.unmount())
})

it('preserves the original preview list presentation with authoritative server content', async () => {
  const transport = actions()
  transport.preview = vi.fn(async () => ({ previewRef: 'server', title: '服务端冻结标题', summary: '服务端冻结要点', transcript: [], expiresAtMillis: Date.now() + 60000 }))
  const renderer = await mount(transport)
  await act(async () => button(renderer, '分享到此对话').props.onClick())
  const dialog = renderer.root.findByProps({ role: 'dialog' })
  expect(dialog.findByType('strong').props.children).toBe('服务端冻结标题')
  expect(dialog.findByType('ul').findByType('li').props.children).toBe('服务端冻结要点')
  await act(async () => renderer.unmount())
})

it('preserves a narrowed partial quote when opening and saving without an edit', async () => {
  const transport = actions()
  transport.rangeOptions = vi.fn(async () => ({ revision: entry.revision, evidence: entry.evidence, selectedEvidenceIds: ['s2'] }))
  const renderer = await mount(transport, { evidence: [{ ...entry.evidence[1]!, text: '二句' }], selectedEvidenceIds: ['s2'] })
  const open = async () => {
    await act(async () => renderer.root.findByProps({ 'aria-label': '线下交流更多操作' }).props.onClick())
    await act(async () => button(renderer, '调整录音范围').props.onClick())
  }
  await open()
  expect(renderer.root.findAllByType('select').map(node => node.props.value)).toEqual(['s2', 's2'])
  expect(renderer.root.findByProps({ role: 'dialog' }).findAllByType('p').map(node => text(node.props.children))).toContain('二句')
  await act(async () => button(renderer, '保存').props.onClick())
  expect(transport.change).not.toHaveBeenCalled()
  expect(renderer.root.findAllByProps({ role: 'dialog' })).toHaveLength(0)
  await open()
  await act(async () => renderer.root.findAllByType('select')[0]!.props.onChange({ target: { value: 's1' } }))
  await act(async () => button(renderer, '保存').props.onClick())
  expect(transport.change).toHaveBeenCalledWith(expect.objectContaining({ change: { kind: 'range', evidenceIds: ['s1', 's2'] } }))
  await act(async () => renderer.unmount())
})

it('does not fill excluded gaps merely by reopening the range editor', async () => {
  const transport = actions()
  const third = { ...entry.evidence[1]!, id: 's3', text: '第三句话' }
  transport.rangeOptions = vi.fn(async () => ({ revision: entry.revision, evidence: [...entry.evidence, third], selectedEvidenceIds: ['s1', 's3'] }))
  const renderer = await mount(transport, { evidence: [entry.evidence[0]!, third], selectedEvidenceIds: ['s1', 's3'] })
  await act(async () => renderer.root.findByProps({ 'aria-label': '线下交流更多操作' }).props.onClick())
  await act(async () => button(renderer, '调整录音范围').props.onClick())
  const preview = renderer.root.findByProps({ role: 'dialog' }).findAllByType('p').map(node => text(node.props.children))
  expect(preview).not.toContain('第二句话')
  await act(async () => button(renderer, '保存').props.onClick())
  expect(transport.change).not.toHaveBeenCalled()
  await act(async () => renderer.unmount())
})

it('requires an explicit new range when current sources cannot preserve the old selection', async () => {
  const transport = actions()
  transport.rangeOptions = vi.fn(async () => ({ revision: entry.revision, evidence: entry.evidence, selectedEvidenceIds: [] }))
  const renderer = await mount(transport, { sourceState: 'unavailable', evidence: [], selectedEvidenceIds: [] })
  await act(async () => renderer.root.findByProps({ 'aria-label': '线下交流更多操作' }).props.onClick())
  await act(async () => button(renderer, '调整录音范围').props.onClick())
  const selects = renderer.root.findAllByType('select')
  expect(selects.map(node => node.props.value)).toEqual(['', ''])
  expect(button(renderer, '保存').props.disabled).toBe(true)
  await act(async () => { selects[0]!.props.onChange({ target: { value: 's2' } }); selects[1]!.props.onChange({ target: { value: 's2' } }) })
  expect(button(renderer, '保存').props.disabled).toBe(false)
  await act(async () => button(renderer, '保存').props.onClick())
  expect(transport.change).toHaveBeenCalledWith(expect.objectContaining({ change: { kind: 'range', evidenceIds: ['s2'] } }))
  await act(async () => renderer.unmount())
})
