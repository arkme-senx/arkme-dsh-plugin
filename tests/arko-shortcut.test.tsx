import { act, create, type ReactTestRenderer, type ReactTestInstance } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ArkmeDocumentComposerInput } from '../src/client/ArkmeDocumentComposerInput.js'
import { ArkmeArkoSurface } from '../src/client/ArkmeArkoSurface.js'
import { ArkmeClientError, callArkme } from '../src/client/api.js'
import { readArkoPendingTurn } from '../src/client/arko-pending-turn-store.js'
import type { ArkmeArkoHistoryItem } from '../src/types.js'
import { arkmeAuthStore } from '../src/client/auth-store.js'
import { arkmeArkoProfileStore } from '../src/client/arko-profile-store.js'
import { arkmeArkoComposerDraftKey, arkmeComposerDraftStore } from '../src/client/composer-draft-store.js'

vi.mock('../src/client/api.js', async importOriginal => ({
  ...await importOriginal<typeof import('../src/client/api.js')>(), callArkme: vi.fn(),
}))

// These tests exercise Arko orchestration; the real editor is covered in arko-emoji-dom and browser tests.
vi.mock('../src/client/ArkmeDocumentComposerInput.js', async () => {
  const { forwardRef } = await import('react')
  return { ArkmeDocumentComposerInput: forwardRef(() => null) }
})

const draftKey = arkmeArkoComposerDraftKey(10001)
const result = { sessionId: 88, userMsgId: 1, assistantMsgId: 2, status: 'completed', text: '可以帮你记录', reasoning: '', createdRecordUids: [] }
let renderer: ReactTestRenderer
let ask: ReturnType<typeof vi.fn>
let sessionAvailable: boolean
let history: ArkmeArkoHistoryItem[]

async function mount() {
  await act(async () => { renderer = create(<ArkmeArkoSurface />) })
}
function visibleText(node: ReactTestInstance): string { return node.children.map(child => typeof child === 'string' ? child : visibleText(child)).join('') }
function shortcut() { return renderer.root.findByProps({ 'aria-label': 'Arko 能干什么' }) }

beforeEach(() => {
  arkmeArkoProfileStore.activateUser(undefined)
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
  arkmeArkoProfileStore.activateUser(undefined)
  arkmeComposerDraftStore.clearAccount(10001)
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

describe('Arko capability shortcut', () => {
  it.each(['accepted', 'queued', 'running', 'stream_timeout', 'waiting_tool', 'waiting_user', 'completed', 'partial', 'cancelled', 'expired', 'failed'])('omits history message footnotes for %s without hiding the answer', async runStatus => {
    history = [{ messageId: 8, sessionId: 88, role: 'assistant', text: '历史回答', reasoning: '', createdAtMillis: 1,
      status: 1, runUid: 'existing-run', runStatus, createdRecordUids: [] }]
    await mount()
    const message = renderer.root.findAllByType('li')[0]!
    const answer = message.findAllByType('p').find(node => visibleText(node) === '历史回答')!
    expect(visibleText(answer)).toBe('历史回答')
    // The message body ends at the answer bubble, with no trailing status line.
    const bubble = answer.parent!
    expect(bubble.parent!.children.at(-1)).toBe(bubble)
  })

  it('preserves answer text that happens to match the removed completion label', async () => {
    ask.mockResolvedValueOnce({ ...result, text: '已完成' })
    await mount()
    await act(async () => { shortcut().props.onClick() })
    const answer = renderer.root.findAllByType('li').at(-1)!.findByType('p')
    expect(visibleText(answer)).toBe('已完成')
    expect(answer.parent!.parent!.children.at(-1)).toBe(answer.parent)
    expect(shortcut().props.disabled).toBe(false)
  })

  it('retains real reasoning and error content independently of removed footnotes', async () => {
    ask.mockResolvedValueOnce({ ...result, status: 'failed', text: '', errorMessage: '无法访问指定内容', reasoning: '已检查访问权限' })
    await mount()
    await act(async () => { shortcut().props.onClick() })
    const message = renderer.root.findAllByType('li').at(-1)!
    expect(message.findAllByType('p').map(node => visibleText(node))).toEqual(['已检查访问权限', '无法访问指定内容'])
    expect(shortcut().props.disabled).toBe(false)
    expect(readArkoPendingTurn(10001)).toBeUndefined()
  })

  it.each([[], ['record-1']])('omits immediate result footnotes and permits the next send: %j', async createdRecordUids => {
    ask.mockResolvedValueOnce({ ...result, createdRecordUids })
    await mount()
    await act(async () => { shortcut().props.onClick() })
    const message = renderer.root.findAllByType('li').at(-1)!
    const bubble = message.findByType('p').parent!
    expect(visibleText(bubble.findByType('p'))).toBe('可以帮你记录')
    expect(bubble.parent!.children.at(-1)).toBe(bubble)
    expect(shortcut().props.disabled).toBe(false)
    expect(readArkoPendingTurn(10001)).toBeUndefined()
    await act(async () => { shortcut().props.onClick() })
    expect(ask).toHaveBeenCalledTimes(2)
  })

  it.each([false, true])('unlocks after background completion when profile refresh fails: %s', async profileFails => {
    vi.useFakeTimers()
    let profileCalls = 0
    const original = vi.mocked(callArkme).getMockImplementation()!
    vi.mocked(callArkme).mockImplementation(async (method, input) => {
      if (method === 'arko.run.status') return { status: 'completed' } as never
      if (method === 'arko.profile' && ++profileCalls > 1) {
        if (profileFails) throw new Error('profile refresh unavailable')
        return { displayName: '新名称', version: 2 } as never
      }
      return original(method, input)
    })
    ask.mockResolvedValueOnce({ ...result, status: 'running', runUid: 'run-1' })
    await mount()
    await act(async () => { shortcut().props.onClick() })
    expect(shortcut().props.disabled).toBe(true)
    await act(async () => { await vi.advanceTimersByTimeAsync(1200) })
    const expectedName = profileFails ? 'Arko' : '新名称'
    const button = renderer.root.findByProps({ 'aria-label': `${expectedName} 能干什么` })
    expect(button.findByType('span').children.join('')).toBe(`${expectedName} 能干什么`)
    expect(button.props.disabled).toBe(false)
    expect(vi.mocked(callArkme)).toHaveBeenCalledWith('arko.run.status', { sessionId: 88, runUid: 'run-1' }, expect.any(AbortSignal))
    expect(ask).toHaveBeenCalledTimes(1)
    const bubble = renderer.root.findAllByType('li').at(-1)!.findByType('p').parent!
    expect(bubble.parent!.children.at(-1)).toBe(bubble)
  })

  it.each([false, true])('retains cancellation feedback and controls without message footnotes, failure: %s', async fails => {
    const original = vi.mocked(callArkme).getMockImplementation()!
    vi.mocked(callArkme).mockImplementation(async (method, input) => {
      if (method === 'arko.cancel') {
        if (fails) throw new Error('cancel unavailable')
        return {} as never
      }
      return original(method, input)
    })
    ask.mockResolvedValueOnce({ ...result, status: 'running', runUid: 'run-1' })
    await mount()
    await act(async () => { shortcut().props.onClick() })
    await act(async () => { renderer.root.findByProps({ title: '停止当前任务' }).props.onClick() })
    expect(callArkme).toHaveBeenCalledWith('arko.cancel', { sessionId: 88, assistantMsgId: 2, runUid: 'run-1' })
    expect(JSON.stringify(renderer.toJSON())).toContain(fails ? '停止 Arko 任务失败：cancel unavailable' : '已请求停止当前任务，正在确认最终状态')
    expect(renderer.root.findByProps({ title: '停止当前任务' }).props.disabled).toBe(false)
    expect(shortcut().props.disabled).toBe(true)
    expect(ask).toHaveBeenCalledTimes(1)
  })

  it('recovers a failed history load through the visible retry control', async () => {
    let historyCalls = 0
    const original = vi.mocked(callArkme).getMockImplementation()!
    vi.mocked(callArkme).mockImplementation(async (method, input) => {
      if (method === 'arko.history' && ++historyCalls === 1) throw new Error('history unavailable')
      return original(method, input)
    })
    history = [{ messageId: 8, sessionId: 88, role: 'assistant', text: '恢复的回答', reasoning: '', createdAtMillis: 1,
      status: 1, runStatus: 'completed', createdRecordUids: [] }]
    await mount()
    expect(JSON.stringify(renderer.toJSON())).toContain('history unavailable')
    const retry = renderer.root.findAllByType('button').find(button => button.children.includes('重新加载'))!
    await act(async () => { retry.props.onClick() })
    expect(JSON.stringify(renderer.toJSON())).not.toContain('history unavailable')
    expect(visibleText(renderer.root.findAllByType('li')[0]!.findByType('p'))).toBe('恢复的回答')
    expect(shortcut().props.disabled).toBe(false)
  })

  it('unlocks through matching terminal history when status polling fails', async () => {
    vi.useFakeTimers()
    const original = vi.mocked(callArkme).getMockImplementation()!
    vi.mocked(callArkme).mockImplementation(async (method, input) => {
      if (method === 'arko.run.status') throw new Error('status unavailable')
      return original(method, input)
    })
    ask.mockResolvedValueOnce({ ...result, status: 'running', runUid: 'run-1' })
    await mount()
    await act(async () => { shortcut().props.onClick() })
    history = [{ messageId: 2, sessionId: 88, role: 'assistant', text: '最终回答', reasoning: '', createdAtMillis: 1,
      status: 1, runUid: 'run-1', runStatus: 'completed', createdRecordUids: [] }]
    await act(async () => { await vi.advanceTimersByTimeAsync(1200) })
    expect(shortcut().props.disabled).toBe(false)
    expect(renderer.root.findAllByProps({ title: '停止当前任务' })).toHaveLength(0)
    expect(JSON.stringify(renderer.toJSON())).toContain('最终回答')
    expect(ask).toHaveBeenCalledTimes(1)
  })

  it('keeps sending available when loading the optional profile fails', async () => {
    const original = vi.mocked(callArkme).getMockImplementation()!
    vi.mocked(callArkme).mockImplementation(async (method, input) => {
      if (method === 'arko.profile') throw new Error('profile unavailable')
      return original(method, input)
    })
    await mount()
    expect(shortcut().props.disabled).toBe(false)
    await act(async () => { shortcut().props.onClick() })
    expect(ask).toHaveBeenCalledTimes(1)
  })

  it('does not roll the displayed name back when an older ask response arrives', async () => {
    let complete!: (value: unknown) => void
    ask.mockImplementationOnce(() => new Promise(resolve => { complete = resolve }))
    await mount()
    await act(async () => { void shortcut().props.onClick() })
    await act(async () => {
      arkmeArkoProfileStore.setProfile(10001, { displayName: '最新名称', version: 3 })
    })
    expect(renderer.root.findByProps({ 'aria-label': '最新名称 能干什么' }).props.disabled).toBe(true)
    await act(async () => { complete({ ...result, profile: { displayName: '旧名称', version: 2 } }) })
    expect(renderer.root.findByProps({ 'aria-label': '最新名称 能干什么' }).props.disabled).toBe(false)
    expect(ask).toHaveBeenCalledTimes(1)
  })

  it('drops the previous account name and ignores its late profile on account switch', async () => {
    await mount()
    await act(async () => {
      arkmeArkoProfileStore.setProfile(10001, { displayName: '旧账号名称', version: 3 })
    })
    expect(renderer.root.findByProps({ 'aria-label': '旧账号名称 能干什么' })).toBeDefined()
    await act(async () => {
      arkmeAuthStore.setAuth({ status: 'authenticated', environment: 'test', userId: 10002 })
    })
    await act(async () => {
      arkmeArkoProfileStore.setProfile(10001, { displayName: '迟到名称', version: 4 })
    })
    expect(shortcut().props.disabled).toBe(false)
    expect(renderer.root.findAllByProps({ 'aria-label': '旧账号名称 能干什么' })).toHaveLength(0)
    expect(renderer.root.findAllByProps({ 'aria-label': '迟到名称 能干什么' })).toHaveLength(0)
    expect(ask).not.toHaveBeenCalled()
  })

  it.each([
    ['小助', 2, '小助'],
    ['Agent', 0, 'Arko'],
    ['Agent', 2, 'Agent'],
    ['  小助  ', 2, '小助'],
    ['', 2, 'Arko'],
  ])('uses the loaded profile name %j at version %i consistently', async (displayName, version, expected) => {
    const original = vi.mocked(callArkme).getMockImplementation()!
    vi.mocked(callArkme).mockImplementation(async (method, input) => method === 'arko.profile'
      ? { displayName, version } as never
      : original(method, input))
    await mount()
    const button = renderer.root.findByProps({ 'aria-label': `${expected} 能干什么` })
    expect(button.findByType('span').children.join('')).toBe(`${expected} 能干什么`)
    expect(renderer.root.findByType('h2').children.join('')).toBe(expected)
    expect(button.props.disabled).toBe(false)
    expect(ask).not.toHaveBeenCalled()
  })

  it('updates the shortcut from an ask response profile without losing the draft or locking normal send', async () => {
    ask.mockResolvedValueOnce({ ...result, profile: { displayName: '小助', version: 2 } })
    arkmeComposerDraftStore.setText(draftKey, '继续正常聊天')
    await mount()
    await act(async () => { shortcut().props.onClick() })
    const renamed = renderer.root.findByProps({ 'aria-label': '小助 能干什么' })
    expect(renamed.findByType('span').children.join('')).toBe('小助 能干什么')
    expect(renamed.props.disabled).toBe(false)
    expect(arkmeComposerDraftStore.get(draftKey).text).toBe('继续正常聊天')
    const textarea = renderer.root.findByType(ArkmeDocumentComposerInput)
    expect(textarea.props.ariaLabel).toBe('发送给 小助')
    await act(async () => {
      textarea.props.onKeyDown({ key: 'Enter', shiftKey: false, nativeEvent: { isComposing: false }, preventDefault: vi.fn() })
    })
    expect(ask).toHaveBeenCalledTimes(2)
    expect(ask.mock.calls[0]![0].text).toBe('你能帮我干什么')
    expect(ask.mock.calls[1]![0].text).toBe('继续正常聊天')
  })

  it('updates the visible and accessible shortcut name when the assistant is renamed', async () => {
    await mount()
    expect(shortcut().findByType('span').children).toEqual(['Arko 能干什么'])
    await act(async () => {
      arkmeArkoProfileStore.setProfile(10001, {
        ...arkmeArkoProfileStore.getSnapshot().profile!, displayName: '小助', version: 2,
      })
    })
    const renamed = renderer.root.findByProps({ 'aria-label': '小助 能干什么' })
    expect(renamed.findByType('span').children.join('')).toBe('小助 能干什么')
    expect(renderer.root.findAllByProps({ 'aria-label': 'Arko 能干什么' })).toHaveLength(0)
    await act(async () => { renamed.props.onClick() })
    expect(ask).toHaveBeenCalledWith(expect.objectContaining({ text: '你能帮我干什么' }))
  })

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
    const keyDown = renderer.root.findByType(ArkmeDocumentComposerInput).props.onKeyDown
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
    expect(renderer.root.findAllByType(ArkmeDocumentComposerInput)).toHaveLength(0)
    act(() => renderer.root.findByProps({ 'aria-label': '退出多选' }).props.onClick())
    expect(shortcut().props.disabled).toBe(false)
    expect(renderer.root.findByType(ArkmeDocumentComposerInput).props.value).toBe('多选前草稿')
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
