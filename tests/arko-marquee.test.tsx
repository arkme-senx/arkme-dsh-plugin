import { ArkmeMessageSelectionControl, messageSelectionStyles } from '../src/client/message-selection-presentation.js'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { ArkmeArkoSurface } from '../src/client/ArkmeArkoSurface.js'
import { RegionMarquee } from '../src/client/selection/RegionMarquee.js'
import { callArkme } from '../src/client/api.js'
import { arkmeAuthStore } from '../src/client/auth-store.js'
import { arkmeArkoProfileStore } from '../src/client/arko-profile-store.js'
import type { ArkmeArkoHistoryItem } from '../src/types.js'
vi.mock('../src/client/api.js', async original => ({ ...await original<typeof import('../src/client/api.js')>(), callArkme: vi.fn() }))
vi.mock('../src/client/ArkmeDocumentComposerInput.js', async () => {
  const { forwardRef } = await import('react')
  return { ArkmeDocumentComposerInput: forwardRef(() => null) }
})
let renderer: ReactTestRenderer
let history: ArkmeArkoHistoryItem[]
const item = (id: number, extra: Partial<ArkmeArkoHistoryItem> = {}): ArkmeArkoHistoryItem => ({
  messageId: id, sessionId: 88, role: id % 2 ? 'user' : 'assistant', text: `正文${id}`, reasoning: '',
  createdAtMillis: id, status: 2, createdRecordUids: [], messageActionRef: `action-${id}`,
  messageActionConversationRef: 'session-88', messageActionCapabilities: { copyLink: true, forward: true }, ...extra,
})
beforeEach(() => {
  history = [item(1), item(2, { messageActionRef: undefined, messageActionConversationRef: undefined }), item(3, { role: 'divider' })]
  vi.stubGlobal('requestAnimationFrame', () => 0); vi.stubGlobal('cancelAnimationFrame', vi.fn())
  vi.stubGlobal('document', { activeElement: null, body: {} })
  arkmeArkoProfileStore.activateUser(undefined)
  arkmeAuthStore.setAuth({ status: 'authenticated', environment: 'test', userId: 10001 })
  vi.mocked(callArkme).mockReset()
  vi.mocked(callArkme).mockImplementation(async operation => {
    if (operation === 'arko.session') return { sessionId: 88 } as never
    if (operation === 'arko.history') return { items: history } as never
    if (operation === 'arko.models') return { options: [], effectiveRouteKey: 'model' } as never
    if (operation === 'arko.profile') return { displayName: 'Arko', version: 1 } as never
    if (operation === 'user.profile') return { profile: {} } as never
    throw new Error(`unexpected ${operation}`)
  })
})
afterEach(() => { if (renderer) act(() => renderer.unmount()); arkmeArkoProfileStore.activateUser(undefined); vi.unstubAllGlobals() })
async function mount() { await act(async () => { renderer = create(<ArkmeArkoSurface />) }) }
async function select(...ids: string[]) { await act(async () => renderer.root.findByType(RegionMarquee).props.onCommit(new Set(ids))) }
const bar = () => renderer.root.findAll(node => node.props.role === 'toolbar' && String(node.props['aria-label']).startsWith('已选择'))[0]
const button = (label: string) => bar()!.findByProps({ 'aria-label': label })
it('selects user and assistant messages without action evidence and never registers dividers', async () => {
  await mount()
  expect(renderer.root.findAll(node => node.type === 'li' && node.props['data-arko-selection-key'])).toHaveLength(2)
  await select('history:1', 'history:2', 'history:3', 'missing')
  expect(bar()!.props['aria-label']).toBe('已选择 2 条消息')
  expect(button('转发').props.disabled).toBe(true)
  expect(button('复制链接').props.disabled).toBe(true)
  expect(vi.mocked(callArkme).mock.calls.some(([op]) => op.startsWith('message-actions.'))).toBe(false)
  const row = renderer.root.findByProps({ 'data-arko-selection-key': 'history:2' })
  await act(async () => row.findByProps({ 'aria-label': '取消选择消息' }).props.onClick({ stopPropagation() {} }))
  expect(button('转发').props.disabled).toBe(false)
})
it('keeps plain text copy available for a selected message without an action ref', async () => {
  await mount(); await select('history:2')
  expect(button('复制文本').props.disabled).toBe(false)
  expect(button('复制链接').props.disabled).toBe(true)
})
it('selects over 100 messages without silently allowing a partial batch', async () => {
  history = Array.from({ length: 101 }, (_, index) => item(index + 1))
  await mount(); await select(...history.map(value => `history:${value.messageId}`))
  expect(bar()!.props['aria-label']).toBe('已选择 101 条消息')
  expect(button('转发').props.disabled).toBe(true)
  expect(button('复制链接').props.disabled).toBe(true)
})
it('keeps display selection separate from cross-session action eligibility', async () => {
  history = [item(1), item(2, { messageActionConversationRef: 'session-older' })]
  await mount(); await select('history:1', 'history:2')
  expect(bar()!.props['aria-label']).toBe('已选择 2 条消息')
  expect(button('转发').props.disabled).toBe(true)
  await act(async () => button('转发').props.onClick())
  expect(vi.mocked(callArkme).mock.calls.some(([op]) => op === 'sources.list')).toBe(false)
})
it('clears selection on account changes and blocks marquee while a dialog is open', async () => {
  await mount(); await select('history:1')
  const before = renderer.root.findByType(RegionMarquee).props.scopeKey
  await act(async () => arkmeAuthStore.setAuth({ status: 'authenticated', environment: 'test', userId: 10002 }))
  expect(bar()).toBeUndefined()
  expect(renderer.root.findByType(RegionMarquee).props.scopeKey).not.toBe(before)
  await act(async () => renderer.root.findByProps({ title: '清除上下文' }).props.onClick())
  expect(renderer.root.findByType(RegionMarquee).props.enabled).toBe(false)
})

it('selects a generating assistant message without turning reasoning into copyable text', async () => {
  history = [item(2, { text: '', reasoning: '正在思考内容', status: 1, runStatus: 'running', messageActionRef: undefined, messageActionConversationRef: undefined })]
  await mount(); await select('history:2')
  expect(bar()!.props['aria-label']).toBe('已选择 1 条消息')
  expect(button('复制链接').props.disabled).toBe(true)
  expect(renderer.root.findByProps({ 'data-arko-selection-key': 'history:2' })).toBeDefined()
})
it('requires every selected operation to carry its own conversation evidence', async () => {
  history = [item(1), item(2, { messageActionConversationRef: '' })]
  await mount(); await select('history:1', 'history:2')
  expect(button('复制链接').props.disabled).toBe(true)
  expect(button('转发').props.disabled).toBe(true)
})

it('uses the common left selection rail for both message roles and the labeled exit action', async () => {
  await mount(); await select('history:1', 'history:2')
  const controls = renderer.root.findAllByType(ArkmeMessageSelectionControl)
  expect(controls).toHaveLength(2)
  for (const control of controls) {
    expect(control.parent!.type).toBe('li')
    expect(control.parent!.props.style).toMatchObject({ display: 'grid', gridTemplateColumns: messageSelectionStyles.rowSelectAvatarMode.gridTemplateColumns })
    expect(control.parent!.props.style.background).toBe(messageSelectionStyles.rowSelectedForAction.background)
    expect(control.findByType('button').props.role).toBe('checkbox')
  }
  expect(button('退出多选').findAllByType('span').some(node => node.children.includes('退出多选'))).toBe(true)
})

it('copies selected emoji messages as visible text using the same projection as menu actions', async () => {
  const writeText = vi.fn(async () => {})
  vi.stubGlobal('navigator', { clipboard: { writeText } })
  vi.stubGlobal('document', { activeElement: null, body: {}, defaultView: { navigator } })
  vi.stubGlobal('window', Object.assign(new EventTarget(), { setTimeout: vi.fn() }))
  history = [item(1, { text: '你好[jm_emoji:smiling_face]', messageActionRef: undefined })]
  await mount(); await select('history:1')
  await act(async () => button('复制文本').props.onClick())
  expect(writeText).toHaveBeenCalledWith('你好😊')
})
