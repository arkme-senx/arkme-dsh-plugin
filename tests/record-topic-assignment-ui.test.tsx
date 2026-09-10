import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ArkmeConfirmDialog } from '../src/client/ArkmeConfirmDialog.js'
import { ArkmeRecordTopicAssignmentDialog } from '../src/client/ArkmeRecordTopicAssignmentDialog.js'

const source = { sourceRef: 'self', kind: 'send_to_self' as const, displayName: '发给自己', activeAtMillis: 0, unreadCount: 0 }
const topic = { ...source, kind: 'topic' as const, sourceRef: 'topic-a', topicHierarchyKey: 'topic-a-key', displayName: '工作' }
const result = { movedRecordUids: ['record-a'], projectionRefreshPending: true }
function setup() {
  return { port: { listTopics: vi.fn(async () => ({ items: [topic], hasMore: false })),
    createTopic: vi.fn(async () => topic), assign: vi.fn(async () => result) },
    source, assignmentRefs: ['assignment-a'], firstRecordText: '新主题内容', onCancel: vi.fn(), onAssigned: vi.fn(), onRefresh: vi.fn() }
}
let renderer: ReactTestRenderer | undefined
const button = (label: string) => renderer!.root.findAllByType('button').find(node => node.props['aria-label'] === label || node.children.join('') === label)!
afterEach(async () => { await act(async () => renderer?.unmount()); renderer = undefined })
describe('personal record topic assignment dialog', () => {
  it.each([0, 101])('rejects invalid selection size before creating a topic: %s', async count => {
    const props = { ...setup(), assignmentRefs: Array.from({ length: count }, (_, i) => `assignment-${i}`) }
    await act(async () => { renderer = create(<ArkmeRecordTopicAssignmentDialog {...props} />) })
    await act(async () => { button('新建主题').props.onClick(); button('指定到工作').props.onClick() })
    expect(props.port.createTopic).not.toHaveBeenCalled()
    expect(props.port.assign).not.toHaveBeenCalled()
    expect(renderer!.root.findByProps({ role: 'alert' }).children.join('')).toContain('1 至 100')
    expect(renderer!.root.findByType(ArkmeConfirmDialog).props.busy).toBe(false)
  })
  it('loads topics and cancels without a mutation', async () => {
    const props = setup()
    await act(async () => { renderer = create(<ArkmeRecordTopicAssignmentDialog {...props} />) })
    await act(async () => renderer!.root.findByType(ArkmeConfirmDialog).props.onClose())
    expect(props.onCancel).toHaveBeenCalledOnce()
    expect(props.port.assign).not.toHaveBeenCalled()
  })
  it('uses the frozen selection and reports acknowledged success separately from projection lag', async () => {
    const props = setup()
    await act(async () => { renderer = create(<ArkmeRecordTopicAssignmentDialog {...props} />) })
    await act(async () => button('指定到工作').props.onClick())
    expect(props.port.assign).toHaveBeenCalledWith({ sourceRef: 'self', assignmentRefs: ['assignment-a'], targetSourceRef: 'topic-a' }, expect.any(AbortSignal))
    expect(props.onAssigned).toHaveBeenCalledWith(result, topic)
  })
  it('locks synchronously against double clicks and cancellation while pending', async () => {
    const props = setup()
    let finish!: (value: typeof result) => void
    props.port.assign.mockImplementation(() => new Promise(resolve => { finish = resolve }))
    await act(async () => { renderer = create(<ArkmeRecordTopicAssignmentDialog {...props} />) })
    const click = button('指定到工作').props.onClick
    await act(async () => { click(); click() })
    expect(props.port.assign).toHaveBeenCalledOnce()
    expect(renderer!.root.findByType(ArkmeConfirmDialog).props.busy).toBe(true)
    await act(async () => { finish(result) })
  })
  it('does not apply a late write acknowledgement after unmount', async () => {
    const props = setup()
    let finish!: (value: typeof result) => void
    props.port.assign.mockImplementation(() => new Promise(resolve => { finish = resolve }))
    await act(async () => { renderer = create(<ArkmeRecordTopicAssignmentDialog {...props} />) })
    await act(async () => { button('指定到工作').props.onClick() })
    await act(async () => { renderer!.unmount(); finish(result) })
    expect(props.onAssigned).not.toHaveBeenCalled()
  })
  it('preserves selection on failure and requires a fresh read before another write', async () => {
    const props = setup()
    props.port.assign.mockRejectedValue(new Error('网络超时'))
    await act(async () => { renderer = create(<ArkmeRecordTopicAssignmentDialog {...props} />) })
    await act(async () => button('指定到工作').props.onClick())
    expect(renderer!.root.findByProps({ role: 'alert' }).children.join('')).toContain('网络超时')
    expect(props.onAssigned).not.toHaveBeenCalled()
    expect(button('指定到工作').props.disabled).toBe(true)
    await act(async () => button('刷新并重新选择').props.onClick())
    expect(props.onRefresh).toHaveBeenCalledOnce()
  })
  it('does not recreate a topic after create succeeded but assignment failed', async () => {
    const props = setup()
    props.port.assign.mockRejectedValue(new Error('归属已变化'))
    await act(async () => { renderer = create(<ArkmeRecordTopicAssignmentDialog {...props} />) })
    await act(async () => button('新建主题').props.onClick())
    expect(props.port.createTopic).toHaveBeenCalledOnce()
    expect(renderer!.root.findByProps({ role: 'alert' }).children.join('')).toContain('工作')
    expect(button('新建主题').props.disabled).toBe(true)
  })
  it('ignores an old search response and keeps the server-filtered latest result', async () => {
    const props = setup()
    let finishOld!: (page: { items: typeof topic[]; hasMore: boolean }) => void
    props.port.listTopics.mockImplementationOnce(() => new Promise(resolve => { finishOld = resolve }))
    await act(async () => { renderer = create(<ArkmeRecordTopicAssignmentDialog {...props} />) })
    await act(async () => { renderer!.root.findByType('input').props.onChange({ currentTarget: { value: '工作' } }) })
    await act(async () => { finishOld({ items: [{ ...topic, sourceRef: 'old', displayName: '旧结果' }], hasMore: false }) })
    expect(button('指定到工作')).toBeDefined()
    expect(button('指定到旧结果')).toBeUndefined()
    expect(props.port.listTopics).toHaveBeenLastCalledWith('工作', undefined, expect.any(AbortSignal))
  })
  it('replaces a renamed topic by stable hierarchy identity across pages', async () => {
    const props = setup()
    props.port.listTopics.mockResolvedValueOnce({ items: [{ ...topic, topicHierarchyKey: 'stable-topic' }], hasMore: true, nextCursor: 'next' } as never)
      .mockResolvedValueOnce({ items: [{ ...topic, sourceRef: 'renamed-ref', topicHierarchyKey: 'stable-topic', displayName: '新标题' }], hasMore: false } as never)
    await act(async () => { renderer = create(<ArkmeRecordTopicAssignmentDialog {...props} />) })
    await act(async () => { button('加载更多主题').props.onClick() })
    expect(button('指定到工作')).toBeUndefined()
    expect(button('指定到新标题')).toBeDefined()
  })
  it('loads the next topic page and deduplicates by source identity', async () => {
    const props = setup()
    props.port.listTopics.mockResolvedValueOnce({ items: [topic], hasMore: true, nextCursor: 'page-2' } as never)
      .mockResolvedValueOnce({ items: [topic, { ...topic, sourceRef: 'second', topicHierarchyKey: 'second-key', displayName: '生活' }], hasMore: false })
    await act(async () => { renderer = create(<ArkmeRecordTopicAssignmentDialog {...props} />) })
    await act(async () => { button('加载更多主题').props.onClick() })
    expect(props.port.listTopics).toHaveBeenLastCalledWith('', 'page-2', expect.any(AbortSignal))
    expect(renderer!.root.findAllByProps({ 'aria-label': '指定到工作' })).toHaveLength(1)
    expect(button('指定到生活')).toBeDefined()
  })
  it('exposes retry on topic read failure without changing selection', async () => {
    const props = setup()
    props.port.listTopics.mockRejectedValueOnce(new Error('服务不可用'))
    await act(async () => { renderer = create(<ArkmeRecordTopicAssignmentDialog {...props} />) })
    expect(button('重试')).toBeDefined()
    await act(async () => { button('重试').props.onClick() })
    expect(button('指定到工作')).toBeDefined()
    expect(props.port.assign).not.toHaveBeenCalled()
  })
  it('requires recovery when the server claims more topics without a cursor', async () => {
    const props = setup()
    props.port.listTopics.mockResolvedValue({ items: [topic], hasMore: true })
    await act(async () => { renderer = create(<ArkmeRecordTopicAssignmentDialog {...props} />) })
    expect(button('重试')).toBeDefined()
    expect(button('指定到工作')).toBeUndefined()
  })
  it('does not assign when topic creation fails, and uses a bounded first-record title', async () => {
    const props = setup()
    props.firstRecordText = ' 标题内容'.repeat(20)
    props.port.createTopic.mockRejectedValue(new Error('创建失败'))
    await act(async () => { renderer = create(<ArkmeRecordTopicAssignmentDialog {...props} />) })
    await act(async () => { button('新建主题').props.onClick() })
    expect(props.port.createTopic).toHaveBeenCalledWith(Array.from(props.firstRecordText.trim()).slice(0, 24).join(''), 'self', expect.any(AbortSignal))
    expect(props.port.assign).not.toHaveBeenCalled()
    expect(button('新建主题').props.disabled).toBe(true)
  })
  it('creates once and assigns the frozen selection to the created topic', async () => {
    const props = setup()
    await act(async () => { renderer = create(<ArkmeRecordTopicAssignmentDialog {...props} />) })
    await act(async () => { button('新建主题').props.onClick() })
    expect(props.port.createTopic).toHaveBeenCalledOnce()
    expect(props.port.assign).toHaveBeenCalledWith({ sourceRef: source.sourceRef, assignmentRefs: props.assignmentRefs,
      targetSourceRef: topic.sourceRef }, expect.any(AbortSignal))
    expect(props.onAssigned).toHaveBeenCalledWith(result, topic)
  })
  it('does not move records if a created topic arrives after the dialog scope was closed', async () => {
    const props = setup()
    let finish!: (value: typeof topic) => void
    props.port.createTopic.mockImplementation(() => new Promise(resolve => { finish = resolve }))
    await act(async () => { renderer = create(<ArkmeRecordTopicAssignmentDialog {...props} />) })
    await act(async () => { button('新建主题').props.onClick() })
    await act(async () => { renderer!.unmount(); finish(topic) })
    expect(props.port.assign).not.toHaveBeenCalled()
    expect(props.onAssigned).not.toHaveBeenCalled()
  })
  it('retries the failed next page without losing earlier choices or restarting the cursor', async () => {
    const props = setup()
    props.port.listTopics.mockResolvedValueOnce({ items: [topic], hasMore: true, nextCursor: 'next' } as never)
      .mockRejectedValueOnce(new Error('page failed')).mockResolvedValueOnce({ items: [], hasMore: false })
    await act(async () => { renderer = create(<ArkmeRecordTopicAssignmentDialog {...props} />) })
    await act(async () => { button('加载更多主题').props.onClick() })
    expect(button('指定到工作')).toBeDefined()
    await act(async () => { button('重试').props.onClick() })
    expect(props.port.listTopics).toHaveBeenLastCalledWith('', 'next', expect.any(AbortSignal))
    expect(button('指定到工作')).toBeDefined()
  })
  it('only exposes release within a personal topic', async () => {
    const props = setup()
    await act(async () => { renderer = create(<ArkmeRecordTopicAssignmentDialog {...props} />) })
    expect(button('移出主题')).toBeUndefined()
    await act(async () => { renderer!.update(<ArkmeRecordTopicAssignmentDialog {...props} source={topic} />) })
    await act(async () => button('移出主题').props.onClick())
    expect(props.port.assign).toHaveBeenCalledWith({ sourceRef: 'topic-a', assignmentRefs: ['assignment-a'] }, expect.any(AbortSignal))
  })
})

it('uses the desktop picker layout and shows count/current metadata without confirmation footer', async () => {
 const props = setup()
 props.port.listTopics.mockResolvedValue({ items: [{ ...topic, recordCount: 12 }], hasMore: false })
 await act(async () => { renderer = create(<ArkmeRecordTopicAssignmentDialog {...props} currentTopicKey={topic.topicHierarchyKey} />) })
 expect(renderer!.root.findByType(ArkmeConfirmDialog).props.layout).toBe('picker')
 expect(renderer!.root.findAllByType('footer')).toHaveLength(0)
 expect(renderer!.root.findByType('input').props.placeholder).toBe('搜索主题名')
 expect(JSON.stringify(button('指定到工作').children.map(child => typeof child === 'string' ? child : child.props.children))).toContain('当前主题')
 await act(async () => { renderer!.update(<ArkmeRecordTopicAssignmentDialog {...props} />) })
 expect(button('指定到工作').findAllByType('span').at(-1)!.children).toEqual(['12'])
})

it('keeps an already-current topic open and does not submit a redundant assignment', async () => {
 const props = setup()
 await act(async () => { renderer = create(<ArkmeRecordTopicAssignmentDialog {...props} currentTopicKey={topic.topicHierarchyKey} />) })
 await act(async () => button('指定到工作').props.onClick())
 expect(props.port.assign).not.toHaveBeenCalled()
 expect(props.onAssigned).not.toHaveBeenCalled()
 expect(renderer!.root.findByProps({ role: 'status' }).children).toEqual(['已在当前主题中！'])
})
