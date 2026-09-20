import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({ callArkme: vi.fn() }))
vi.mock('react-dom', () => ({ createPortal: (node: unknown) => node }))
vi.mock('../src/client/api.js', () => ({ callArkme: state.callArkme, ArkmeClientError: class extends Error {} }))
import { ArkmeSurface } from '../src/client/ArkmeSidebar.js'
import { RegionMarquee } from '../src/client/selection/RegionMarquee.js'
import { arkmeAuthStore } from '../src/client/auth-store.js'
import { arkmeChatDirectory, arkmeChatTimelineDelta, arkmeInterwovenInvalidation } from '../src/client/chat-directory-store.js'
import { arkmeUi } from '../src/client/ui-controller.js'

const source = { sourceRef: 'marquee-source', sourceKey: 'chat:marquee', kind: 'private_chat' as const,
  displayName: '框选会话', activeAtMillis: 1, unreadCount: 0, latestSequence: 1 }
const selfTarget = { ...source, sourceRef: 'marquee-self', sourceKey: 'self:9981',
  kind: 'send_to_self' as const, displayName: '发给自己' }
const messages = Array.from({ length: 105 }, (_, index) => ({
  itemUid: `record-${index}`, timelineItemKey: `occurrence-${index}`,
  senderName: index % 2 ? '他人' : '我', isMe: index % 2 === 0, sendAtMillis: index + 1,
  title: '', textContent: `消息 ${index}`, status: 1,
  ...(index === 2 ? {} : { messageActionRef: `action-${index}` }),
}))
let renderer: ReactTestRenderer
async function render() { await act(async () => { renderer = create(<ArkmeSurface productChrome={false} />) }) }
async function select(...keys: string[]) {
  await act(async () => renderer.root.findByType(RegionMarquee).props.onCommit(new Set(keys)))
}
const toolbar = () => renderer.root.findAll(node => node.props.role === 'toolbar' && String(node.props['aria-label']).startsWith('已选择'))[0]
function action(text: string) {
  return toolbar()!.findAllByType('button').find(button => button.findAll(node => node.type === 'span' && node.children.includes(text)).length > 0)!
}
function renderedText(node: ReactTestInstance): string {
  return node.children.map(child => typeof child === 'string' ? child : renderedText(child)).join('')
}
beforeEach(() => {
  state.callArkme.mockReset()
  state.callArkme.mockImplementation(async (operation: string) => {
    if (operation === 'source.timeline') return { source, items: messages, hasMore: false }
    if (operation === 'source.members') return { source, items: [], total: 0, activeCount: 0 }
    if (operation === 'files.send.tasks') return []
    if (operation === 'provider.instance') return { instanceId: 'marquee-test-provider' }
    if (operation === 'sources.list') return { items: [source], hasMore: false }
    if (operation === 'sources.self-target') return selfTarget
    if (operation === 'source.interwoven-moments') return { state: 'disabled', moments: [], preparedAtMillis: 1 }
    if (operation === 'user.profile' || operation === 'user.profile.refresh') return { profile: null, cachedAtMillis: 1, revision: 1 }
    if (operation === 'source.long-article.draft.get') return undefined
    throw new Error(`unexpected operation ${operation}`)
  })
  arkmeAuthStore.setAuth({ status: 'authenticated', environment: 'test', userId: 9981 })
  arkmeChatDirectory.activateAccount('test:9981'); arkmeChatTimelineDelta.activateAccount(9981); arkmeInterwovenInvalidation.activateAccount(9981)
  arkmeUi.selectSource(source)
})
afterEach(() => {
  if (renderer) act(() => renderer.unmount())
  arkmeUi.showLogin(); arkmeChatDirectory.activateAccount(undefined)
  arkmeChatTimelineDelta.activateAccount(undefined); arkmeInterwovenInvalidation.activateAccount(undefined)
  vi.unstubAllGlobals()
})

describe('production timeline marquee selection', () => {
  it('registers every displayed message occurrence and appends existing selection', async () => {
    await render()
    const rows = renderer.root.findAll(node => node.type === 'li' && node.props['data-arkme-selection-key'])
    expect(rows).toHaveLength(105)
    await select('occurrence-0', 'occurrence-1')
    expect(toolbar()!.props['aria-label']).toBe('已选择 2 条消息')
    await select('occurrence-2', 'missing')
    expect(toolbar()!.props['aria-label']).toBe('已选择 3 条消息')
    expect(action('转发').props.disabled).toBe(true)
    expect(action('复制链接').props.disabled).toBe(true)
    const unsupportedRow = renderer.root.findAll(node => node.type === 'li' && node.props['data-arkme-selection-key'] === 'occurrence-2')[0]!
    const control = unsupportedRow.findAllByType('button').find(node => node.props.role === 'checkbox')
    expect(control).toBeDefined()
    expect(control!.props.disabled).toBe(false)
    expect(state.callArkme.mock.calls.some(call => String(call[0]).includes('message-forward'))).toBe(false)
  })
  it('selects more than 100 messages without issuing a partial operation', async () => {
    await render(); await select(...messages.map(item => item.timelineItemKey))
    expect(toolbar()!.props['aria-label']).toBe('已选择 105 条消息')
    expect(action('转发').props.disabled).toBe(true)
    expect(action('复制链接').props.disabled).toBe(true)
    expect(renderer.root.findAll(node => node.props.role === 'status' && node.children.some(child => typeof child === 'string' && child.includes('批量操作最多支持 100')))).toHaveLength(1)
  })
  it('retains existing capability behavior for eligible selected messages', async () => {
    await render(); await select('occurrence-0')
    expect(action('转发').props.disabled).toBe(false)
    expect(action('复制链接').props.disabled).toBe(false)
    expect(action('复制文本').props.disabled).toBe(false)
  })
  it('clears selection when the conversation changes and disables the retained hidden layer', async () => {
    await render(); await select('occurrence-0')
    await act(async () => { arkmeUi.selectSource({ ...source, sourceRef: 'other-source', sourceKey: 'chat:other' }) })
    expect(toolbar()).toBeUndefined()
    await act(async () => { renderer.update(<ArkmeSurface productChrome={false} active={false} />) })
    expect(renderer.root.findAllByType(RegionMarquee)).toHaveLength(0)
  })
})

it('removes deleted occurrences from formal selection and rejects stale drag keys', async () => {
  await render(); await select('occurrence-0', 'occurrence-1')
  await act(async () => {
    arkmeChatTimelineDelta.applyTimelineChange({ sourceKey: source.sourceKey,
      timelineItemKey: 'occurrence-0', changeKind: 'deleted', changeVersion: 1,
      relationTerminal: true, throughSequence: 106 })
  })
  expect(toolbar()!.props['aria-label']).toBe('已选择 1 条消息')
  await select('occurrence-0')
  expect(toolbar()!.props['aria-label']).toBe('已选择 1 条消息')
  await act(async () => {
    arkmeChatTimelineDelta.applyTimelineChange({ sourceKey: source.sourceKey,
      timelineItemKey: 'occurrence-1', changeKind: 'deleted', changeVersion: 1,
      relationTerminal: true, throughSequence: 107 })
  })
  expect(toolbar()).toBeUndefined()
})
it('restores actions after deselecting an unsupported message without replacing selection', async () => {
  await render(); await select('occurrence-0', 'occurrence-2')
  const row = renderer.root.findAll(node => node.type === 'li' && node.props['data-arkme-selection-key'] === 'occurrence-2')[0]!
  await act(async () => row.findAllByType('button').find(node => node.props.role === 'checkbox')!.props.onClick({ stopPropagation() {} }))
  expect(toolbar()!.props['aria-label']).toBe('已选择 1 条消息')
  expect(action('转发').props.disabled).toBe(false)
  expect(action('复制链接').props.disabled).toBe(false)
})
it('keeps the 100-item action boundary separate from selecting 101 eligible messages', async () => {
  await render()
  const keys = messages.filter(item => item.messageActionRef).map(item => item.timelineItemKey)
  await select(...keys.slice(0, 100))
  expect(action('转发').props.disabled).toBe(false)
  expect(action('复制链接').props.disabled).toBe(false)
  await select(keys[100]!)
  expect(toolbar()!.props['aria-label']).toBe('已选择 101 条消息')
  expect(action('转发').props.disabled).toBe(true)
  expect(action('复制链接').props.disabled).toBe(true)
})
it('opens the existing forward picker and suspends marquee until the picker closes', async () => {
  await render(); await select('occurrence-0', 'occurrence-1')
  await act(async () => action('转发').props.onClick())
  const dialog = renderer.root.findByProps({ 'aria-labelledby': 'arkme-forward-target-title' })
  const targets = dialog.findByProps({ 'aria-label': '转发对象列表' }).findAllByType('button')
  expect(targets).toHaveLength(2)
  expect(targets.some(button => renderedText(button).includes('发给自己'))).toBe(true)
  expect(targets.some(button => renderedText(button).includes('框选会话'))).toBe(true)
  expect(targets.every(button => button.props.disabled !== true)).toBe(true)
  expect(dialog.findAllByProps({ role: 'alert' })).toHaveLength(0)
  expect(renderer.root.findByType(RegionMarquee).props.enabled).toBe(false)
  expect(toolbar()!.props['aria-label']).toBe('已选择 2 条消息')
  const backdrop = renderer.root.findAll(node => node.props['data-arkme-notification-blocking-overlay'] === 'true' && node.props.onMouseDown)[0]!
  const target = {}
  await act(async () => backdrop.props.onMouseDown({ target, currentTarget: target }))
  expect(renderer.root.findAllByProps({ 'aria-labelledby': 'arkme-forward-target-title' })).toHaveLength(0)
  expect(renderer.root.findByType(RegionMarquee).props.enabled).toBe(true)
  expect(toolbar()!.props['aria-label']).toBe('已选择 2 条消息')
})

it('freezes selection during copy-link and restores normal interaction after rejection', async () => {
  vi.stubGlobal('window', Object.assign(new EventTarget(), { setTimeout, clearTimeout, setInterval, clearInterval }))
  let rejectCopy!: (reason: Error) => void
  const previous = state.callArkme.getMockImplementation()!
  state.callArkme.mockImplementation(async (operation, params, signal) => {
    if (operation === 'source.message-copy-link') return await new Promise((_, reject) => { rejectCopy = reject })
    return previous(operation, params, signal)
  })
  await render(); await select('occurrence-0', 'occurrence-1')
  await act(async () => action('复制链接').props.onClick())
  expect(renderer.root.findByType(RegionMarquee).props.enabled).toBe(false)
  const calls = state.callArkme.mock.calls.filter(call => call[0] === 'source.message-copy-link')
  expect(calls).toHaveLength(1)
  expect(calls[0]![1]).toEqual({ sourceRef: source.sourceRef, actionRefs: ['action-0', 'action-1'] })
  await select('occurrence-3')
  expect(toolbar()!.props['aria-label']).toBe('已选择 2 条消息')
  const row = renderer.root.findAll(node => node.type === 'li' && node.props['data-arkme-selection-key'] === 'occurrence-0')[0]!
  const checkbox = row.findAllByType('button').find(node => node.props.role === 'checkbox')!
  expect(checkbox.props.disabled).toBe(true)
  await act(async () => checkbox.props.onClick({ stopPropagation() {} }))
  expect(toolbar()!.props['aria-label']).toBe('已选择 2 条消息')
  await act(async () => { rejectCopy(new Error('fixture rejection')) })
  expect(renderer.root.findByType(RegionMarquee).props.enabled).toBe(true)
  expect(action('复制链接').props.disabled).toBe(false)
  expect(JSON.stringify(renderer.toJSON())).toContain('fixture rejection')
  await select('occurrence-3')
  expect(toolbar()!.props['aria-label']).toBe('已选择 3 条消息')
})
