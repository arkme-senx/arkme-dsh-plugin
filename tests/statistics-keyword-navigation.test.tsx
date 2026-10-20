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
const sample = { text: '完整关键词', occurrenceCount: 5, recordCount: 2 }

beforeEach(() => {
  call.mockReset().mockImplementation(async (op: string, payload: any) => {
    if (op === 'statistics.detail') return { recordCount: 2, days: 1, keywords: [sample] }
    if (op === 'statistics.active') return []
    if (op === 'statistics.long') return { items: [], nextOffset: null }
    if (op === 'calendar.buckets') return { days: [] }
    if (op === 'search.records') return { hasMore: false, items: [
      { recordUid: 'own', recordOwnerUserId: 7, sourceKind: 1, sendAtMillis: Date.now() - 1000, title: '个人快记' },
      { recordUid: 'someone', recordOwnerUserId: 8, sourceKind: 1, sendAtMillis: Date.now() - 1000, title: '其他人内容' },
      { recordUid: 'chat', recordOwnerUserId: 7, sourceKind: 3, sendAtMillis: Date.now() - 1000, title: '聊天内容' },
    ] }
    if (op === 'record.app.detail') return { recordUid: payload.recordUid }
    throw new Error(`unexpected operation ${op}`)
  })
})

describe('statistics keyword source navigation', () => {
  it('opens the frequency drawer, searches the full keyword, filters personal records and opens original text', async () => {
    let tree!: ReactTestRenderer
    await act(async () => { tree = create(<StatisticsSurface accountScope="prod:7"/>) })
    await act(async () => tree.root.findAllByType('button').find(b => content(b) === '查看词频')!.props.onClick())
    const list = tree.root.findByProps({ 'aria-label': '关键词词频列表' })
    await act(async () => list.findByType('button').props.onClick())
    expect(call).toHaveBeenCalledWith('search.records', { query: '完整关键词', limit: 50 }, expect.anything())
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
