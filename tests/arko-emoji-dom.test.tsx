// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ArkmeArkoSurface } from '../src/client/ArkmeArkoSurface.js'
import { ArkmeClientError, callArkme } from '../src/client/api.js'
import { arkmeAuthStore } from '../src/client/auth-store.js'
import { arkmeArkoProfileStore } from '../src/client/arko-profile-store.js'
import { arkmeDefaultEmojis } from '../src/client/arkme-emoji.js'
import { arkmeArkoComposerDraftKey, arkmeComposerDraftStore, arkmeSourceComposerDraftKey, serializeArkmeComposerDraft } from '../src/client/composer-draft-store.js'
import { readArkoPendingTurn } from '../src/client/arko-pending-turn-store.js'
import type { ArkmeArkoHistoryItem } from '../src/types.js'
import type { Editor } from '@tiptap/core'

vi.mock('../src/client/api.js', async importOriginal => ({
  ...await importOriginal<typeof import('../src/client/api.js')>(), callArkme: vi.fn(),
}))

const emoji = arkmeDefaultEmojis[0]!
const draftKey = arkmeArkoComposerDraftKey(10001)
const result = { sessionId: 88, userMsgId: 1, assistantMsgId: 2, status: 'completed', text: '收到', reasoning: '', createdRecordUids: [] }
let root: Root
let host: HTMLDivElement
let ask: ReturnType<typeof vi.fn>
let history: ArkmeArkoHistoryItem[]

function editor(): HTMLElement { return host.querySelector('[role="textbox"]')! }
function documentEditor(): Editor { return (editor() as HTMLElement & { editor: Editor }).editor }
function button(label: string): HTMLButtonElement {
  return document.querySelector(`button[aria-label="${label}"]`)!
}
async function click(node: HTMLElement) {
  expect(node).not.toBeNull()
  await act(async () => { node.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true })); node.click() })
}
async function mount() { await act(async () => { root.render(<ArkmeArkoSurface />) }) }
function serialized() { return serializeArkmeComposerDraft(arkmeComposerDraftStore.get(draftKey)).text }
function select(start: number, end = start) {
  editor().focus()
  const text = document.createTreeWalker(editor(), NodeFilter.SHOW_TEXT).nextNode() ?? editor()
  const range = document.createRange()
  range.setStart(text, start)
  range.setEnd(text, end)
  const selection = document.getSelection()!
  selection.removeAllRanges()
  selection.addRange(range)
}
async function chooseEmoji() {
  if (button('选择表情').getAttribute('aria-expanded') !== 'true') await click(button('选择表情'))
  await click(document.querySelector(`[data-arkme-emoji-grid="default"] [data-arkme-emoji-id="${emoji.id}"]`)!)
}
async function send() { await click(host.querySelector('button[title="发送"]')!) }

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { callback(0); return 0 })
  vi.stubGlobal('cancelAnimationFrame', vi.fn())
  vi.spyOn(window, 'scrollBy').mockImplementation(() => {})
  // jsdom supplies DOM selection but has no layout implementation.
  Range.prototype.getBoundingClientRect = () => new DOMRect(20, 100, 1, 21)
  Range.prototype.getClientRects = () => ({ length: 0, item: () => null }) as unknown as DOMRectList
  sessionStorage.clear()
  arkmeComposerDraftStore.clearAccount(10001)
  arkmeComposerDraftStore.clearAccount(20002)
  arkmeArkoProfileStore.activateUser(undefined)
  arkmeAuthStore.setAuth({ status: 'authenticated', environment: 'test', userId: 10001 })
  ask = vi.fn().mockResolvedValue(result)
  history = []
  vi.mocked(callArkme).mockImplementation(async (method, input) => {
    if (method === 'arko.ask') return ask(input)
    if (method === 'arko.session') return { sessionId: 88 } as never
    if (method === 'arko.history') return { items: history } as never
    if (method === 'arko.models') return { options: [], effectiveRouteKey: 'model-a' } as never
    if (method === 'arko.profile') return { displayName: 'Arko', version: 1 } as never
    if (method === 'user.profile') return { profile: {} } as never
    if (method === 'emoji.recent.list') return [] as never
    if (method === 'emoji.recent.record') return [emoji.id] as never
    throw new Error(`unexpected method: ${method}`)
  })
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
  arkmeComposerDraftStore.clearAccount(10001)
  arkmeComposerDraftStore.clearAccount(20002)
  arkmeArkoProfileStore.activateUser(undefined)
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  vi.clearAllMocks()
})

describe('Arko emoji input and send boundary', () => {
  it('undoes and redoes text and rich emoji using the existing editor history', async () => {
    await mount()
    act(() => documentEditor().commands.insertContent('abc'))
    act(() => documentEditor().commands.undo())
    expect(serialized()).toBe('')
    act(() => documentEditor().commands.redo())
    expect(serialized()).toBe('abc')
    await chooseEmoji()
    const withEmoji = serialized()
    act(() => documentEditor().commands.undo())
    expect(arkmeComposerDraftStore.get(draftKey).emojis).toHaveLength(0)
    act(() => documentEditor().commands.redo())
    expect(serialized()).toBe(withEmoji)
    expect(editor().querySelector('[data-arkme-editable-emoji]')).not.toBeNull()
    await send()
    expect(ask).toHaveBeenCalledWith(expect.objectContaining({ text: withEmoji }))
  })

  it('keeps distinct adjacent emoji identities when inserting before and replacing among them', async () => {
    await mount()
    await chooseEmoji()
    const second = arkmeDefaultEmojis[1]!
    act(() => documentEditor().commands.setTextSelection(1))
    await click(document.querySelector(`[data-arkme-emoji-grid="default"] [data-arkme-emoji-id="${second.id}"]`)!)
    expect(serialized()).toBe(second.token + emoji.token)
    expect(Array.from(editor().querySelectorAll('[data-arkme-editable-emoji]'), node => node.getAttribute('data-arkme-editable-emoji'))).toEqual([second.id, emoji.id])
    act(() => documentEditor().commands.setTextSelection({ from: 1, to: 2 }))
    await chooseEmoji()
    expect(serialized()).toBe(emoji.token + emoji.token)
    act(() => documentEditor().commands.undo())
    act(() => documentEditor().commands.redo())
    expect(serialized()).toBe(emoji.token + emoji.token)
    await send()
    expect(ask).toHaveBeenCalledWith(expect.objectContaining({ text: emoji.token + emoji.token }))
  })

  it.each([[0, 0], [0, 1], [0, 2], [0, 3], [1, 1], [1, 2], [1, 3], [2, 2], [2, 3], [3, 3]])('keeps document and draft identical when replacing adjacent emoji range %i:%i', async (start, end) => {
    const choices = arkmeDefaultEmojis.slice(0, 3)
    arkmeComposerDraftStore.setRichText(draftKey, '\uFFFC'.repeat(3), choices.map((item, startIndex) => ({ emojiId: item.id, startIndex })))
    await mount()
    act(() => documentEditor().commands.setTextSelection({ from: start + 1, to: end + 1 }))
    await chooseEmoji()
    const expected = [...choices.slice(0, start), emoji, ...choices.slice(end)]
    expect(serialized()).toBe(expected.map(item => item.token).join(''))
    expect(Array.from(editor().querySelectorAll('[data-arkme-editable-emoji]'), node => node.getAttribute('data-arkme-editable-emoji'))).toEqual(expected.map(item => item.id))
  })

  it('uses the visible selection before keyboard handling when selectionchange is still pending', async () => {
    arkmeComposerDraftStore.setText(draftKey, '前替换后')
    await mount()
    act(() => documentEditor().commands.setTextSelection(5))
    select(1, 3)
    act(() => editor().dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true })))
    expect(documentEditor().state.selection.from).toBe(2)
    expect(documentEditor().state.selection.to).toBe(4)
  })

  it('pastes into the visible selection even before selectionchange is delivered', async () => {
    arkmeComposerDraftStore.setText(draftKey, '前替换后')
    await mount()
    act(() => documentEditor().commands.setTextSelection(5))
    select(1, 3)
    const event = new Event('paste', { bubbles: true, cancelable: true })
    Object.defineProperty(event, 'clipboardData', { value: { getData: (kind: string) => kind === 'text/plain' ? '粘贴' : '' } })
    act(() => editor().dispatchEvent(event))
    expect(serialized()).toBe('前粘贴后')
  })

  it.each(['copy', 'cut'])('uses the visible selection for a native %s event without a preceding shortcut', async kind => {
    arkmeComposerDraftStore.setText(draftKey, '前复制后')
    await mount()
    act(() => documentEditor().commands.setTextSelection(5))
    select(1, 3)
    const clipboard = new Map<string, string>()
    const event = new Event(kind, { bubbles: true, cancelable: true })
    Object.defineProperty(event, 'clipboardData', { value: {
      clearData: () => clipboard.clear(), setData: (format: string, text: string) => clipboard.set(format, text),
    } })
    act(() => editor().dispatchEvent(event))
    expect(clipboard.get('text/plain')).toBe('复制')
    expect(serialized()).toBe(kind === 'cut' ? '前后' : '前复制后')
  })

  it('preserves a pending native selection when the Arko profile rerenders the composer', async () => {
    arkmeComposerDraftStore.setText(draftKey, '前替换后')
    await mount()
    act(() => documentEditor().commands.setTextSelection(5))
    select(1, 3)
    act(() => arkmeArkoProfileStore.setProfile(10001, { displayName: '新 Arko', version: 2 }))
    expect(document.getSelection()?.toString()).toBe('替换')
    await chooseEmoji()
    expect(serialized()).toBe('前' + emoji.token + '后')
  })

  it('copies editor emoji as readable text without leaking the draft placeholder', async () => {
    await mount()
    await chooseEmoji()
    act(() => documentEditor().commands.setTextSelection({ from: 1, to: 2 }))
    const copied = documentEditor().view.serializeForClipboard(documentEditor().state.selection.content())
    expect(copied.text).toBe(emoji.unicode)
  })

  it('copies a rendered message as readable Unicode instead of internal emoji tokens', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    vi.stubGlobal('navigator', { userAgent: navigator.userAgent, platform: navigator.platform, maxTouchPoints: 0, clipboard: { writeText } })
    history = [{ messageId: 3, sessionId: 88, role: 'user', text: `前${emoji.token}后`,
      reasoning: '', status: 1, createdAtMillis: 1, createdRecordUids: [],
      messageActionRef: 'message-ref', messageActionConversationRef: 'conversation-ref' }]
    await mount()
    act(() => host.querySelector('[data-arkme-rich-emoji]')!.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 30, clientY: 30 })))
    await click(button('复制'))
    expect(writeText).toHaveBeenCalledWith(`前${emoji.unicode}后`)
    expect(history[0]!.text).toBe(`前${emoji.token}后`)
  })

  it('pastes multiple literal lines without interpreting Markdown or creating chat metadata', async () => {
    await mount()
    const text = '# 标题\n**文字**\nhttps://example.com\n@某人'
    const event = new Event('paste', { bubbles: true, cancelable: true })
    Object.defineProperty(event, 'clipboardData', { value: { getData: (kind: string) => kind === 'text/plain' ? text : '' } })
    act(() => editor().dispatchEvent(event))
    expect(serialized()).toBe(text)
    expect(editor().querySelector('h1,strong,a,[data-arkme-mention],[data-arkme-editable-tag]')).toBeNull()
    expect(arkmeComposerDraftStore.get(draftKey)).toMatchObject({ mentions: [], emojis: [] })
    expect(arkmeComposerDraftStore.get(draftKey).markdown).toBeUndefined()
    await send()
    expect(ask).toHaveBeenCalledWith(expect.objectContaining({ text }))
  })

  it('replaces an existing emoji even when semantic text length stays unchanged and restores it on undo', async () => {
    await mount()
    await chooseEmoji()
    act(() => documentEditor().commands.setTextSelection({ from: 1, to: 2 }))
    await click(document.querySelector(`[data-arkme-emoji-grid="default"] [data-arkme-emoji-id="${arkmeDefaultEmojis[1]!.id}"]`)!)
    expect(serialized()).toBe(arkmeDefaultEmojis[1]!.token)
    expect(editor().querySelector('[data-arkme-editable-emoji]')?.getAttribute('data-arkme-editable-emoji')).toBe(arkmeDefaultEmojis[1]!.id)
    act(() => documentEditor().commands.undo())
    // Consecutive picker operations may form one history group; redo must restore the complete final projection.
    act(() => documentEditor().commands.redo())
    expect(serialized()).toBe(arkmeDefaultEmojis[1]!.token)
    await send()
    expect(ask).toHaveBeenCalledWith(expect.objectContaining({ text: arkmeDefaultEmojis[1]!.token }))
  })

  it('replaces the selection, keeps the caret after consecutive emoji, and sends portable text', async () => {
    arkmeComposerDraftStore.setText(draftKey, '前替换后')
    await mount()
    expect(editor()).not.toBeNull()
    select(1, 3)
    await chooseEmoji()
    await chooseEmoji()
    expect(serialized()).toBe(`前${emoji.token}${emoji.token}后`)
    expect(editor().querySelectorAll('[data-arkme-editable-emoji]')).toHaveLength(2)
    expect(document.activeElement).toBe(editor())
    expect(button('收藏表情')).toBeNull()
    expect(vi.mocked(callArkme).mock.calls.some(([method]) => method.startsWith('favorite-stickers.'))).toBe(false)
    await send()
    expect(ask).toHaveBeenCalledOnce()
    expect(ask).toHaveBeenCalledWith(expect.objectContaining({ text: `前${emoji.token}${emoji.token}后`, sessionId: 88 }))
    expect(serialized()).toBe('')
    expect(host.querySelectorAll('[data-arkme-rich-emoji]')).toHaveLength(2)
  })

  it('sends an emoji-only question and retains the existing shortcut draft behavior', async () => {
    await mount()
    await chooseEmoji()
    await click(button('Arko 能干什么'))
    expect(ask).toHaveBeenLastCalledWith(expect.objectContaining({ text: '你能帮我干什么' }))
    expect(serialized()).toBe(emoji.token)
    await send()
    expect(ask).toHaveBeenLastCalledWith(expect.objectContaining({ text: emoji.token }))
  })

  it('restores rich draft on remount and closes the panel on account change', async () => {
    const sourceKey = arkmeSourceComposerDraftKey(10001, { kind: 'private_chat', sourceRef: 'private-chat' })
    arkmeComposerDraftStore.setText(sourceKey, '普通会话草稿')
    await mount()
    await chooseEmoji()
    await act(async () => root.render(null))
    await mount()
    expect(editor().querySelector('[data-arkme-editable-emoji]')).not.toBeNull()
    expect(editor().textContent).not.toContain('普通会话草稿')
    expect(arkmeComposerDraftStore.get(sourceKey).text).toBe('普通会话草稿')
    await click(button('选择表情'))
    await act(async () => { arkmeAuthStore.setAuth({ status: 'authenticated', environment: 'test', userId: 20002 }) })
    expect(editor().textContent).toBe('')
    expect(document.querySelector('[data-arkme-emoji-panel]')).toBeNull()
    await chooseEmoji()
    expect(vi.mocked(callArkme)).toHaveBeenCalledWith('emoji.recent.record', { accountKey: 'test:20002', emojiId: emoji.id }, expect.any(AbortSignal))
  })

  it.each(['emoji.recent.list', 'emoji.recent.record'] as const)('keeps editing and sending usable when %s fails', async failedMethod => {
    const original = vi.mocked(callArkme).getMockImplementation()!
    vi.mocked(callArkme).mockImplementation(async (method, input, signal) => {
      if (method === failedMethod) throw new Error('recent unavailable')
      return original(method, input, signal)
    })
    await mount()
    await click(button('选择表情'))
    if (failedMethod === 'emoji.recent.list') expect(button('重试加载最近表情')).not.toBeNull()
    await chooseEmoji()
    if (failedMethod === 'emoji.recent.record') expect(button('重试保存最近表情')).not.toBeNull()
    expect(editor().getAttribute('aria-disabled')).toBe('false')
    act(() => documentEditor().commands.insertContent('继续输入'))
    await send()
    expect(ask).toHaveBeenCalledWith(expect.objectContaining({ text: emoji.token + '继续输入' }))
  })

  it('renders history tokens without inventing links, mentions, or changing unknown text', async () => {
    history = [{ messageId: 3, sessionId: 88, role: 'user', text: `${emoji.token} [jm_emoji:unknown] https://example.com @某人 #主题`,
      reasoning: '', status: 1, createdAtMillis: 1, createdRecordUids: [] }]
    await mount()
    expect(host.querySelector('[data-arkme-rich-emoji]')).not.toBeNull()
    expect(host.textContent).toContain('[jm_emoji:unknown] https://example.com @某人 #主题')
    expect(host.querySelector('a')).toBeNull()
    const image = host.querySelector('[data-arkme-rich-emoji]')!
    act(() => image.dispatchEvent(new Event('error')))
    expect(host.textContent).toContain(emoji.unicode)
  })

  it('keeps hash-prefixed question text plain instead of enabling chat tag presentation', async () => {
    arkmeComposerDraftStore.setText(draftKey, '#问题 @某人')
    await mount()
    expect(editor().textContent).toBe('#问题 @某人')
    expect(editor().querySelector('span')).toBeNull()
    await send()
    expect(ask).toHaveBeenCalledWith(expect.objectContaining({ text: '#问题 @某人' }))
  })

  it('keeps a serialized pending turn on unknown failure and locks emoji editing', async () => {
    ask.mockRejectedValueOnce(new Error('network disconnected'))
    await mount()
    await chooseEmoji()
    await send()
    expect(readArkoPendingTurn(10001)?.text).toBe(emoji.token)
    expect(button('选择表情').disabled).toBe(true)
    expect(editor().getAttribute('contenteditable')).toBe('false')
    expect(document.querySelector('[data-arkme-emoji-panel]')).toBeNull()
  })

  it('preserves the serialized failed message and unlocks after definitive failure', async () => {
    ask.mockRejectedValueOnce(new ArkmeClientError({ code: 'forbidden', message: '当前不可发送', retryable: false }))
    await mount()
    await chooseEmoji()
    await send()
    expect(readArkoPendingTurn(10001)).toBeUndefined()
    expect(button('选择表情').disabled).toBe(false)
    expect(host.querySelector('[data-arkme-rich-emoji]')).not.toBeNull()
    expect(host.textContent).toContain('当前不可发送')
  })

  it('keeps IME confirmation and Shift Enter out of send, and sends on ordinary Enter', async () => {
    await mount()
    await chooseEmoji()
    await act(async () => {
      editor().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', isComposing: true, bubbles: true, cancelable: true }))
      editor().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', shiftKey: true, bubbles: true, cancelable: true }))
    })
    expect(ask).not.toHaveBeenCalled()
    expect(serialized()).toBe(`${emoji.token}\n`)
    await act(async () => { editor().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })) })
    expect(ask).toHaveBeenCalledWith(expect.objectContaining({ text: emoji.token }))
  })

  it('rejects insertion beyond the wire length without changing the draft', async () => {
    arkmeComposerDraftStore.setText(draftKey, 'x'.repeat(60 * 1024))
    await mount()
    select(60 * 1024)
    await chooseEmoji()
    expect(serialized()).toHaveLength(60 * 1024)
    expect(editor().querySelector('[data-arkme-editable-emoji]')).toBeNull()
    expect(host.textContent).toContain('长度')
    expect(vi.mocked(callArkme).mock.calls.some(([method]) => method === 'emoji.recent.record')).toBe(false)
  })

  it('does not clear a draft or send when serialized text exceeds the limit after typing', async () => {
    arkmeComposerDraftStore.insertEmoji(draftKey, emoji, 0)
    const draft = arkmeComposerDraftStore.get(draftKey)
    arkmeComposerDraftStore.setText(draftKey, draft.text + 'x'.repeat(60 * 1024 - 1))
    await mount()
    await send()
    expect(ask).not.toHaveBeenCalled()
    expect(serialized().length).toBeGreaterThan(60 * 1024)
    expect(host.textContent).toContain('长度')
  })

  it('allows incremental deletion from an oversized restored draft while rejecting further growth', async () => {
    arkmeComposerDraftStore.setRichText(draftKey, '\uFFFC' + 'x'.repeat(60 * 1024 - 1), [{ emojiId: emoji.id, startIndex: 0 }])
    await mount()
    const length = serialized().length
    act(() => documentEditor().commands.deleteRange({ from: 2, to: 3 }))
    expect(serialized()).toHaveLength(length - 1)
    act(() => documentEditor().commands.insertContent('more'))
    expect(serialized()).toHaveLength(length - 1)
    act(() => documentEditor().commands.deleteRange({ from: 1, to: 2 }))
    await send()
    expect(ask).toHaveBeenCalledWith(expect.objectContaining({ text: 'x'.repeat(60 * 1024 - 2) }))
  })

  it('restores focus after the shortcut but respects focus moved outside during submission', async () => {
    await mount()
    button('Arko 能干什么').focus()
    await click(button('Arko 能干什么'))
    expect(document.activeElement).toBe(editor())
    let complete!: (value: unknown) => void
    ask.mockImplementationOnce(() => new Promise(resolve => { complete = resolve }))
    await click(button('Arko 能干什么'))
    const external = document.createElement('button')
    document.body.append(external)
    external.focus()
    await act(async () => complete(result))
    expect(document.activeElement).toBe(external)
    external.remove()
  })

  it('pastes plain text after emoji and atomically removes an emoji without leaking metadata', async () => {
    await mount()
    await chooseEmoji()
    const paste = new Event('paste', { bubbles: true, cancelable: true })
    Object.defineProperty(paste, 'clipboardData', { value: { getData: (type: string) => type === 'text/plain' ? '<b>纯文本</b>' : '' } })
    act(() => editor().dispatchEvent(paste))
    expect(serialized()).toBe(`${emoji.token}<b>纯文本</b>`)
    expect(editor().querySelector('b')).toBeNull()
    await act(async () => {
      editor().querySelector('[data-arkme-editable-emoji]')!.remove()
      editor().dispatchEvent(new InputEvent('input', { inputType: 'deleteContentBackward', bubbles: true }))
      await new Promise(resolve => setTimeout(resolve, 0))
    })
    expect(arkmeComposerDraftStore.get(draftKey).emojis).toHaveLength(0)
    expect(serialized()).toBe('<b>纯文本</b>')
    await send()
    expect(ask).toHaveBeenCalledWith(expect.objectContaining({ text: '<b>纯文本</b>' }))
  })

  it('preserves composed Chinese alongside emoji without submitting an IME confirmation', async () => {
    await mount()
    await chooseEmoji()
    await act(async () => {
      editor().dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }))
      editor().querySelector('p')!.append(document.createTextNode('中文'))
      editor().dispatchEvent(new InputEvent('input', { data: '中文', isComposing: true, bubbles: true }))
      editor().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', isComposing: true, bubbles: true, cancelable: true }))
      editor().dispatchEvent(new CompositionEvent('compositionend', { data: '中文', bubbles: true }))
      await new Promise(resolve => setTimeout(resolve, 30))
    })
    expect(ask).not.toHaveBeenCalled()
    expect(serialized()).toBe(`${emoji.token}中文`)
    await send()
    expect(ask).toHaveBeenCalledWith(expect.objectContaining({ text: `${emoji.token}中文` }))
  })

  it('retries the same serialized turn and idempotency key after an uncertain outcome', async () => {
    ask.mockRejectedValueOnce(new Error('connection lost'))
    await mount()
    await chooseEmoji()
    await send()
    const first = ask.mock.calls[0]![0]
    await click([...host.querySelectorAll('button')].find(node => node.textContent === '重试确认')!)
    expect(ask).toHaveBeenCalledTimes(2)
    expect(ask.mock.calls[1]![0]).toEqual(first)
    expect(first.text).toBe(emoji.token)
    expect(readArkoPendingTurn(10001)).toBeUndefined()
  })

  it('closes on Escape and keeps active-run stop control separate from emoji editing', async () => {
    const original = vi.mocked(callArkme).getMockImplementation()!
    let stopped = false
    vi.mocked(callArkme).mockImplementation(async (method, input, signal) => {
      if (method === 'arko.cancel') {
        stopped = true
        return { sessionId: 88, assistantMsgId: 2, runUid: 'run-1', status: 'cancelling' } as never
      }
      if (method === 'arko.run.status') return {
        sessionId: 88, runUid: 'run-1', status: stopped ? 'cancelled' : 'running',
        sequence: 1, surfaceAssistantMsgId: 2, retryable: false,
      } as never
      return original(method, input, signal)
    })
    await mount()
    await chooseEmoji()
    act(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))
    expect(document.querySelector('[data-arkme-emoji-panel]')).toBeNull()
    ask.mockResolvedValueOnce({ ...result, status: 'running', runUid: 'run-1' })
    await send()
    expect(button('选择表情').disabled).toBe(true)
    expect(button('停止当前 Arko 任务').disabled).toBe(false)
    expect(editor().getAttribute('aria-disabled')).toBe('true')
    await click(button('停止当前 Arko 任务'))
    expect(callArkme).toHaveBeenCalledWith('arko.cancel', { sessionId: 88, assistantMsgId: 2, runUid: 'run-1' })
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 1_250)) })
    expect(editor().getAttribute('aria-disabled')).toBe('false')
    await chooseEmoji()
    await send()
    expect(ask).toHaveBeenCalledTimes(2)
    expect(ask).toHaveBeenLastCalledWith(expect.objectContaining({ text: emoji.token }))
  })
})
