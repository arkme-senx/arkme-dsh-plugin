import React from 'react'
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { describe, expect, it, vi } from 'vitest'
import { StatisticsKeywordList, StatisticsKeywords } from '../src/client/statistics/StatisticsKeywords.js'
import type { StatisticsKeyword } from '../src/statistics-contract.js'

vi.mock('../src/client/locale.js', () => ({ tr: (text: string) => text, arkmeIntlLocale: () => 'zh-CN' }))
const words: StatisticsKeyword[] = [
  { text: '较少', occurrenceCount: 2, recordCount: 1 },
  { text: '这是一条完整的长关键词，点击时不能只取显示的前几个字', occurrenceCount: 9, recordCount: 3 },
]
const content = (node: ReactTestInstance): string => node.children.map(child => typeof child === 'string' ? child : content(child)).join('')
describe('keyword cloud and frequency details', () => {
  it('prioritizes the cloud, keeps full source text, and opens details separately', async () => {
    const onSelect = vi.fn(), onOpenList = vi.fn()
    let tree!: ReactTestRenderer
    await act(async () => { tree = create(<StatisticsKeywords resource={{ value: { keywords: words }, loading: false, error: '' }} onSelect={onSelect} onOpenList={onOpenList} onRetry={() => {}}/>) })
    expect(tree.root.findAllByType('ol')).toHaveLength(0)
    const cloud = tree.root.findByProps({ 'aria-label': '关键词词云' })
    const buttons = cloud.findAllByType('button')
    expect(content(buttons[0]!)).toContain('9 次')
    expect(parseFloat(buttons[0]!.props.style.fontSize)).toBeGreaterThan(parseFloat(buttons[1]!.props.style.fontSize))
    await act(async () => buttons[0]!.props.onClick())
    expect(onSelect).toHaveBeenCalledWith(words[1])
    await act(async () => tree.root.findAllByType('button').find(button => content(button) === '查看词频')!.props.onClick())
    expect(onOpenList).toHaveBeenCalledOnce()
    await act(async () => tree.unmount())
  })
  it('does not mistake a missing count for zero or for the number of records', async () => {
    let tree!: ReactTestRenderer
    const onSelect = vi.fn()
    await act(async () => { tree = create(<StatisticsKeywordList items={[...words, { text: '未知次数', occurrenceCount: null, recordCount: 8 }, { text: '零次', occurrenceCount: 0, recordCount: null }]} onSelect={onSelect}/>) })
    const buttons = tree.root.findAllByType('button')
    expect(content(buttons[0]!)).toContain('涉及 3 条快记')
    expect(content(buttons[0]!)).toContain('9 次')
    expect(content(buttons[2]!)).toContain('0 次')
    expect(content(buttons[3]!)).toContain('涉及 8 条快记')
    expect(content(buttons[3]!)).toContain('次数待提供')
    await act(async () => buttons[3]!.props.onClick())
    expect(onSelect.mock.calls[0]![0].text).toBe('未知次数')
    await act(async () => tree.unmount())
  })
  it('separates missing support, empty results, loading and failures', async () => {
    let tree!: ReactTestRenderer
    const props = { onSelect: vi.fn(), onOpenList: vi.fn(), onRetry: vi.fn() }
    await act(async () => { tree = create(<StatisticsKeywords {...props} resource={{ value: { keywords: null }, loading: false, error: '' }}/>) })
    expect(content(tree.root)).toContain('尚未接通')
    expect(tree.root.findAllByType('button')[0]!.props.disabled).toBe(true)
    await act(async () => tree.update(<StatisticsKeywords {...props} resource={{ value: { keywords: [] }, loading: false, error: '' }}/>))
    expect(content(tree.root)).toContain('此范围暂无关键词')
    expect(content(tree.root)).not.toContain('尚未接通')
    await act(async () => tree.update(<StatisticsKeywords {...props} resource={{ loading: true, error: '' }}/>))
    expect(tree.root.findByProps({ role: 'status' })).toBeTruthy()
    await act(async () => tree.update(<StatisticsKeywords {...props} resource={{ loading: false, error: '网络中断' }}/>))
    expect(content(tree.root)).not.toContain('暂无关键词')
    await act(async () => tree.root.findAllByType('button').find(button => content(button) === '重试')!.props.onClick())
    expect(props.onRetry).toHaveBeenCalledOnce()
    await act(async () => tree.unmount())
  })
  it('limits the overview but retains every returned keyword in details', async () => {
    const items = Array.from({ length: 50 }, (_, i) => ({ text: `词${i}`, occurrenceCount: i + 1, recordCount: null }))
    let tree!: ReactTestRenderer
    const onOpenList = vi.fn()
    await act(async () => { tree = create(<StatisticsKeywords resource={{ value: { keywords: items }, loading: false, error: '' }} onSelect={() => {}} onOpenList={onOpenList} onRetry={() => {}}/>) })
    expect(tree.root.findByProps({ 'aria-label': '关键词词云' }).findAllByType('button')).toHaveLength(18)
    await act(async () => tree.root.findAllByType('button').find(button => content(button).includes('查看全部'))!.props.onClick())
    expect(onOpenList).toHaveBeenCalledOnce()
    await act(async () => tree.update(<StatisticsKeywordList items={items} onSelect={() => {}}/>))
    expect(tree.root.findAllByType('li')).toHaveLength(50)
    await act(async () => tree.unmount())
  })
})
