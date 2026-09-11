import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ArkmeArkoSurface } from '../src/client/ArkmeArkoSurface.js'
import { ArkmeClientError, callArkme } from '../src/client/api.js'
import { readArkoPendingTurn } from '../src/client/arko-pending-turn-store.js'
import type { ArkmeArkoHistoryItem } from '../src/types.js'
import { arkmeAuthStore } from '../src/client/auth-store.js'
import { arkmeArkoComposerDraftKey, arkmeComposerDraftStore } from '../src/client/composer-draft-store.js'

vi.mock('../src/client/api.js', async importOriginal => ({
  ...await importOriginal<typeof import('../src/client/api.js')>(), callArkme: vi.fn(),
}))

const draftKey = arkmeArkoComposerDraftKey(10001)
const result = { sessionId: 88, userMsgId: 1, assistantMsgId: 2, status: 'completed', text: '可以帮你记录', reasoning: '', createdRecordUids: [] }
let renderer: ReactTestRenderer
let ask: ReturnType<typeof vi.fn>
let sessionAvailable: boolean
let history: ArkmeArkoHistoryItem[]

async function mount() {
  await act(async () => { renderer = create(<ArkmeArkoSurface />) })
}
function shortcut() { return renderer.root.findByProps({ 'aria-label': 'Arko 能干什么' }) }

beforeEach(() => {
  sessionAvailable = true
  history = []
  const stored = new Map<string, string>()
  vi.stubGlobal('sessionStorage', { getItem: (key: string) => stored.get(key) ?? null, setItem: (key: string, value: string) => { stored.set(key, value) }, removeItem: (key: string) => { stored.delete(key) } })
  ask = vi.fn().mockResolvedValue(result)
  vi.stubGlobal('requestAnimationFrame', () => 0)
  vi.stubGlobal('cancelAnimationFrame', vi.fn())
  vi.stubGlobal('document', { activeElement: null, body: {} })
  arkmeAuthStore.setAuth({ status: 'authenticated', environment: 'test', userId: 10001 })
  vi.mocked(callArkme).mockImplementation(async (method, input) => {
    if (method === 'arko.ask') return ask(input)
    if (method === 'arko.session') {
      if (!sessionAvailable) throw new Error('session unavailable')
      return { sessionId: 88 } as never
    }
    if (method === 'arko.history') return { items: history } as never
    if (method === 'arko.models') return { options: [], effectiveRouteKey: 'model-a' } as never
    if (method === 'arko.profile') return { displayName: 'Arko', version: 1 } as never
    if (method === 'user.profile') return { profile: {} } as never
    throw new Error(`unexpected method: ${method}`)
  })
})
afterEach(() => {
  if (renderer) act(() => renderer.unmount())
  arkmeComposerDraftStore.clearAccount(10001)
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

describe('Arko capability shortcut', () => {
  it.each(['', '  尚未发送的草稿\n继续编辑  '])('sends the preset through Arko and preserves draft %j', async draft => {
    arkmeComposerDraftStore.setText(draftKey, draft)
    await mount()
    await act(async () => { shortcut().props.onClick() })
    expect(ask).toHaveBeenCalledTimes(1)
    expect(ask).toHaveBeenCalledWith(expect.objectContaining({ text: '你能帮我干什么', sessionId: 88, modelRouteKey: 'model-a' }))
    expect(arkmeComposerDraftStore.get(draftKey).text).toBe(draft)
    expect(JSON.stringify(renderer.toJSON())).toContain('你能帮我干什么')
  })

  it('rejects two clicks in the same render before React updates disabled state', async () => {
    await mount()
    const click = shortcut().props.onClick
    await act(async () => { click(); click() })
    expect(ask).toHaveBeenCalledTimes(1)
  })

  it('retains the turn identity for retry confirmation and keeps the shortcut locked', async () => {
    ask.mockRejectedValueOnce(new Error('connection lost'))
    arkmeComposerDraftStore.setText(draftKey, '保留草稿')
    await mount()
    await act(async () => { shortcut().props.onClick() })
    expect(shortcut().props.disabled).toBe(true)
    const retry = renderer.root.findAllByType('button').find(button => button.children.includes('重试确认'))!
    await act(async () => { retry.props.onClick() })
    expect(ask).toHaveBeenCalledTimes(2)
    expect(ask.mock.calls[1]![0]).toEqual(ask.mock.calls[0]![0])
    expect(arkmeComposerDraftStore.get(draftKey).text).toBe('保留草稿')
    expect(shortcut().props.disabled).toBe(false)
  })

  it('does not send without a usable Arko session', async () => {
    sessionAvailable = false
    await mount()
    expect(shortcut().props.disabled).toBe(true)
    await act(async () => { shortcut().props.onClick() })
    expect(ask).not.toHaveBeenCalled()
  })

  it('locks while the request is outstanding and unlocks after completion', async () => {
    let complete!: (value: typeof result) => void
    ask.mockImplementationOnce(() => new Promise(resolve => { complete = resolve }))
    await mount()
    await act(async () => { shortcut().props.onClick() })
    expect(shortcut().props.disabled).toBe(true)
    await act(async () => { shortcut().props.onClick() })
    expect(ask).toHaveBeenCalledTimes(1)
    await act(async () => { complete(result) })
    expect(shortcut().props.disabled).toBe(false)
  })

  it('keeps the shortcut locked for an active Agent run and retains stop', async () => {
    ask.mockResolvedValueOnce({ ...result, status: 'running', runUid: 'run-1' })
    await mount()
    await act(async () => { shortcut().props.onClick() })
    expect(shortcut().props.disabled).toBe(true)
    expect(renderer.root.findByProps({ title: '停止当前任务' })).toBeDefined()
    await act(async () => { shortcut().props.onClick() })
    expect(ask).toHaveBeenCalledTimes(1)
  })

  it('shares the synchronous guard with ordinary send without losing its draft', async () => {
    arkmeComposerDraftStore.setText(draftKey, '用户草稿')
    await mount()
    const click = shortcut().props.onClick
    const send = renderer.root.findByProps({ title: '发送' }).props.onClick
    await act(async () => { click(); send() })
    expect(ask).toHaveBeenCalledTimes(1)
    expect(arkmeComposerDraftStore.get(draftKey).text).toBe('用户草稿')
  })

  it('disables ordinary send consistently while clearing context, then resumes in the new session', async () => {
    let complete!: (value: unknown) => void
    const original = vi.mocked(callArkme).getMockImplementation()!
    vi.mocked(callArkme).mockImplementation((method, input, signal) => {
      if (method === 'arko.new-session') return new Promise(resolve => { complete = resolve }) as never
      return original(method, input, signal)
    })
    arkmeComposerDraftStore.setText(draftKey, '保留并继续')
    await mount()
    act(() => renderer.root.findByProps({ title: '清除上下文' }).props.onClick())
    await act(async () => { renderer.root.findAllByType('button').find(button => button.children.includes('确认'))!.props.onClick() })
    expect(renderer.root.findByProps({ title: '发送' }).props.disabled).toBe(true)
    expect(shortcut().props.disabled).toBe(true)
    expect(arkmeComposerDraftStore.get(draftKey).text).toBe('保留并继续')
    await act(async () => { complete({ sessionId: 99 }) })
    expect(renderer.root.findByProps({ title: '发送' }).props.disabled).toBe(false)
    await act(async () => { shortcut().props.onClick() })
    expect(ask).toHaveBeenCalledWith(expect.objectContaining({ sessionId: 99 }))
  })

  it('restores input focus after using the shortcut without stealing focus outside the composer', async () => {
    const buttonNode = {}
    const inputNode = { style: {}, scrollHeight: 38, disabled: false, value: '草稿', focus: vi.fn(), setSelectionRange: vi.fn() }
    vi.stubGlobal('document', { activeElement: buttonNode, body: {} })
    vi.stubGlobal('requestAnimationFrame', (callback: () => void) => { callback(); return 1 })
    vi.stubGlobal('cancelAnimationFrame', vi.fn())
    await act(async () => {
      renderer = create(<ArkmeArkoSurface />, { createNodeMock: element => {
        if (element.type === 'textarea') return inputNode
        if (element.type === 'footer') return { contains: (node: unknown) => node === buttonNode }
        return { contains: () => false, scrollHeight: 0, scrollTop: 0 }
      } })
    })
    await act(async () => { shortcut().props.onClick() })
    expect(inputNode.focus).toHaveBeenCalledTimes(1)
    inputNode.focus.mockClear()
    vi.stubGlobal('document', { activeElement: {}, body: {} })
    await act(async () => { shortcut().props.onClick() })
    expect(inputNode.focus).not.toHaveBeenCalled()
  })

  it('recovers from a definitive failure without losing the draft or keeping a pending lock', async () => {
    ask.mockRejectedValueOnce(new ArkmeClientError({ code: 'invalid_request', message: '无法处理请求', retryable: false }))
    arkmeComposerDraftStore.setText(draftKey, '未发送草稿')
    await mount()
    await act(async () => { shortcut().props.onClick() })
    expect(shortcut().props.disabled).toBe(false)
    expect(JSON.stringify(renderer.toJSON())).toContain('无法处理请求')
    expect(arkmeComposerDraftStore.get(draftKey).text).toBe('未发送草稿')
    await act(async () => { shortcut().props.onClick() })
    expect(ask).toHaveBeenCalledTimes(2)
    expect(ask.mock.calls[1]![0].clientTurnUid).not.toBe(ask.mock.calls[0]![0].clientTurnUid)
  })

  it('does not turn IME confirmation or Shift Enter into a normal send', async () => {
    arkmeComposerDraftStore.setText(draftKey, '输入中')
    await mount()
    const keyDown = renderer.root.findByType('textarea').props.onKeyDown
    const preventDefault = vi.fn()
    await act(async () => {
      keyDown({ key: 'Enter', shiftKey: false, nativeEvent: { isComposing: true }, preventDefault })
      keyDown({ key: 'Enter', shiftKey: true, nativeEvent: { isComposing: false }, preventDefault })
    })
    expect(ask).not.toHaveBeenCalled()
    expect(preventDefault).not.toHaveBeenCalled()
    await act(async () => { keyDown({ key: 'Enter', shiftKey: false, nativeEvent: { isComposing: false }, preventDefault }) })
    expect(ask).toHaveBeenCalledWith(expect.objectContaining({ text: '输入中' }))
  })

  it('continues a waiting-user task using both continuation identifiers, not a new model route', async () => {
    history = [{ messageId: 8, sessionId: 88, role: 'assistant', text: '请补充', reasoning: '', createdAtMillis: 1, status: 1,
      runUid: 'existing-run', runStatus: 'waiting_user', createdRecordUids: [] }]
    await mount()
    await act(async () => { shortcut().props.onClick() })
    expect(ask).toHaveBeenCalledWith(expect.objectContaining({ replyToRunUid: 'existing-run', replyToAssistantMsgId: 8 }))
    expect(ask.mock.calls[0]![0]).not.toHaveProperty('modelRouteKey')
  })

  it('does not continue a waiting-user task owned by a different session', async () => {
    history = [{ messageId: 8, sessionId: 77, role: 'assistant', text: '历史问题', reasoning: '', createdAtMillis: 1, status: 1,
      runUid: 'old-run', runStatus: 'waiting_user', createdRecordUids: [] }]
    await mount()
    await act(async () => { shortcut().props.onClick() })
    expect(ask).toHaveBeenCalledWith(expect.objectContaining({ sessionId: 88, modelRouteKey: 'model-a' }))
    expect(ask.mock.calls[0]![0]).not.toHaveProperty('replyToRunUid')
    expect(ask.mock.calls[0]![0]).not.toHaveProperty('replyToAssistantMsgId')
  })

  it('restores an uncertain shortcut on remount without resending and retries its exact request', async () => {
    ask.mockRejectedValueOnce(new Error('connection lost'))
    arkmeComposerDraftStore.setText(draftKey, '刷新后保留')
    await mount()
    await act(async () => { shortcut().props.onClick() })
    const saved = readArkoPendingTurn(10001)
    expect(saved?.text).toBe('你能帮我干什么')
    expect(readArkoPendingTurn(20002)).toBeUndefined()
    act(() => renderer.unmount())
    await mount()
    expect(shortcut().props.disabled).toBe(true)
    expect(ask).toHaveBeenCalledTimes(1)
    const retry = renderer.root.findAllByType('button').find(button => button.children.includes('重试确认'))!
    await act(async () => { retry.props.onClick() })
    expect(ask.mock.calls[1]![0]).toEqual(ask.mock.calls[0]![0])
    expect(readArkoPendingTurn(10001)).toBeUndefined()
    expect(arkmeComposerDraftStore.get(draftKey).text).toBe('刷新后保留')
  })

  it('hides the shortcut and composer during message selection and restores the draft on exit', async () => {
    vi.stubGlobal('window', Object.assign(new EventTarget(), { innerWidth: 1024, innerHeight: 768 }))
    history = [{ messageId: 8, sessionId: 88, role: 'assistant', text: '历史回答', reasoning: '', createdAtMillis: 1, status: 1,
      createdRecordUids: [], messageActionRef: 'message-ref', messageActionConversationRef: 'conversation-ref' }]
    arkmeComposerDraftStore.setText(draftKey, '多选前草稿')
    await mount()
    const bubble = renderer.root.findAll(node => typeof node.props.onContextMenu === 'function')[0]!
    act(() => bubble.props.onContextMenu({ preventDefault: vi.fn(), stopPropagation: vi.fn(), clientX: 40, clientY: 40 }))
    act(() => renderer.root.findByProps({ 'aria-label': '多选' }).props.onClick())
    expect(renderer.root.findAllByProps({ 'aria-label': 'Arko 能干什么' })).toHaveLength(0)
    expect(renderer.root.findAllByType('textarea')).toHaveLength(0)
    act(() => renderer.root.findByProps({ 'aria-label': '退出多选' }).props.onClick())
    expect(shortcut().props.disabled).toBe(false)
    expect(renderer.root.findByType('textarea').props.value).toBe('多选前草稿')
    expect(ask).not.toHaveBeenCalled()
  })

  it('blocks the shortcut until initialization finishes', async () => {
    let complete!: (value: unknown) => void
    const original = vi.mocked(callArkme).getMockImplementation()!
    vi.mocked(callArkme).mockImplementation((method, input, signal) => method === 'arko.session'
      ? new Promise(resolve => { complete = resolve }) as never : original(method, input, signal))
    await mount()
    expect(shortcut().props.disabled).toBe(true)
    await act(async () => { shortcut().props.onClick() })
    expect(ask).not.toHaveBeenCalled()
    await act(async () => { complete({ sessionId: 88 }) })
    expect(shortcut().props.disabled).toBe(false)
  })

  it('keeps both send controls disabled until model switching finishes', async () => {
    const models = { options: [
      { routeKey: 'model-a', displayName: 'A', description: '', selected: true },
      { routeKey: 'model-b', displayName: 'B', description: '', selected: false },
    ], effectiveRouteKey: 'model-a' }
    let complete!: (value: unknown) => void
    const original = vi.mocked(callArkme).getMockImplementation()!
    vi.mocked(callArkme).mockImplementation((method, input, signal) => {
      if (method === 'arko.models') return Promise.resolve(models) as never
      if (method === 'arko.model.activate') return new Promise(resolve => { complete = resolve }) as never
      return original(method, input, signal)
    })
    arkmeComposerDraftStore.setText(draftKey, '草稿')
    await mount()
    act(() => renderer.root.findByProps({ title: '选择模型' }).props.onClick())
    const option = renderer.root.findAllByType('button').find(button => button.findAll(node => node.type === 'span' && node.children.includes('B')).length > 0)!
    await act(async () => { option.props.onClick() })
    expect(shortcut().props.disabled).toBe(true)
    expect(renderer.root.findByProps({ title: '发送' }).props.disabled).toBe(true)
    await act(async () => { complete({ ...models, effectiveRouteKey: 'model-b' }) })
    await act(async () => { shortcut().props.onClick() })
    expect(ask).toHaveBeenCalledWith(expect.objectContaining({ modelRouteKey: 'model-b' }))
    expect(arkmeComposerDraftStore.get(draftKey).text).toBe('草稿')
  })

  it('keeps ordinary draft sending and clearing unchanged', async () => {
    arkmeComposerDraftStore.setText(draftKey, '  我的问题  ')
    await mount()
    await act(async () => { renderer.root.findByProps({ title: '发送' }).props.onClick() })
    expect(ask).toHaveBeenCalledWith(expect.objectContaining({ text: '我的问题' }))
    expect(arkmeComposerDraftStore.get(draftKey).text).toBe('')
  })
})
