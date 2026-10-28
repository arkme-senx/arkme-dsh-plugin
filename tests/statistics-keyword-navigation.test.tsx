import React from 'react'
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { StatisticsSurface } from '../src/client/statistics/StatisticsSurface.js'

const { call } = vi.hoisted(() => ({ call: vi.fn() }))
vi.mock('../src/client/api.js', () => ({ callArkme: call }))
vi.mock('../src/client/read-deadline.js', () => ({ withArkmeReadDeadline: (fn: (s: AbortSignal) => unknown, signal: AbortSignal) => fn(signal) }))
vi.mock('../src/client/locale.js', () => ({ tr: (text: string) => text, arkmeIntlLocale: () => 'zh-CN', useArkmeLocale: () => {} }))
vi.mock('../src/client/arkme-membership.js', () => ({ useMembership: () => ({ state: { status: 'ready', value: { memberType: 1 } } }) }))
vi.mock('../src/client/ui-controller.js', () => ({ arkmeUi: { openCalendarDate: vi.fn() } }))
vi.mock('../src/client/arkme-theme.js', () => ({ arkmeTheme: {} }))
vi.mock('../src/client/ArkmeDetailShell.js', () => ({ ArkmeDetailShell: (p: any) => <aside hidden={p.open === false} aria-label={p.label}>{p.onBack && <button onClick={p.onBack}>{p.backLabel}</button>}<button onClick={p.onClose}>关闭</button>{p.children}</aside> }))
vi.mock('../src/client/ArkmeNoteDetails.js', () => ({ ArkmeTimelineDetailDrawer: ({ item }: any) => <div aria-label="原文">{item.recordUid}</div> }))
const content = (node: ReactTestInstance): string => node.children.map(child => typeof child === 'string' ? child : content(child)).join('')
const sample = { keywordId: 'keyword1', snapshotId: 'snapshot1', text: '完整关键词', occurrenceCount: 5, recordCount: 2 }

beforeEach(() => {
  call.mockReset().mockImplementation(async (op: string, payload: any) => {
    if (op === 'statistics.keywords') return { keywords: [sample], snapshotId: 'snapshot1', algorithmVersion: 'test', coverage: { complete: true, records: 2, candidateLimit: 50, returned: 1 } }
    if (op === 'statistics.detail') return { recordCount: 2, days: 1, keywords: [sample] }
    if (op === 'statistics.active') return []
    if (op === 'statistics.long') return { items: [], nextOffset: null }
    if (op === 'calendar.buckets') return { days: [] }
    if (op === 'statistics.keyword-records') return { total: 1, hasMore: false, items: [{ recordUid: 'own', sendAtMillis: Date.now() - 1000, title: '个人快记', textContent: '', occurrenceCount: 5 }] }
    if (op === 'record.app.detail') return { recordUid: payload.recordUid }
    throw new Error(`unexpected operation ${op}`)
  })
})

describe('statistics keyword source navigation', () => {
  it('opens the existing drawer, reads snapshot-bound exact sources and opens original text', async () => {
    let tree!: ReactTestRenderer
    await act(async () => { tree = create(<StatisticsSurface accountScope="prod:7"/>) })
    await act(async () => tree.root.findAllByType('button').find(b => content(b) === '查看词频')!.props.onClick())
    const list = tree.root.findByProps({ 'aria-label': '关键词词频列表' })
    await act(async () => list.findByType('button').props.onClick())
    expect(call).toHaveBeenCalledWith('statistics.keyword-records', expect.objectContaining({ keywordId: 'keyword1', snapshotId: 'snapshot1', accountScope: 'prod:7' }), expect.anything())
    expect(call.mock.calls.some(c => c[0] === 'search.records')).toBe(false)
    let drawer = tree.root.findByProps({ 'aria-label': '关键词相关快记' })
    expect(content(drawer)).toContain('个人快记')
    expect(content(drawer)).not.toContain('其他人内容')
    expect(content(drawer)).not.toContain('聊天内容')
    await act(async () => drawer.findAllByType('button').find(b => content(b) === '返回词频列表')!.props.onClick())
    expect(tree.root.findByProps({ 'aria-label': '词频详情' }).props.hidden).toBe(false)
    await act(async () => tree.root.findByProps({ 'aria-label': '关键词词频列表' }).findByType('button').props.onClick())
    drawer = tree.root.findByProps({ 'aria-label': '关键词相关快记' })
    await act(async () => drawer.findAllByType('button').find(b => content(b).startsWith('个人快记'))!.props.onClick())
    expect(call).toHaveBeenCalledWith('record.app.detail', { recordUid: 'own' }, expect.anything())
    expect(content(tree.root.findByProps({ 'aria-label': '原文' }))).toBe('own')
    await act(async () => tree.unmount())
  })
  it('closes old keyword details when changing the statistics range', async () => {
    let tree!: ReactTestRenderer
    await act(async () => { tree = create(<StatisticsSurface accountScope="prod:7"/>) })
    await act(async () => tree.root.findAllByType('button').find(b => content(b) === '查看词频')!.props.onClick())
    await act(async () => tree.root.findAllByType('button').find(b => content(b) === '按月')!.props.onClick())
    expect(tree.root.findAllByProps({ 'aria-label': '词频详情' })).toHaveLength(0)
    expect(tree.root.findAllByProps({ 'aria-label': '关键词相关快记' })).toHaveLength(0)
    await act(async () => tree.unmount())
  })
})
