// @vitest-environment jsdom
import { webcrypto } from 'node:crypto'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { ArkmeMessageTextSelectionToolbar, registeredMessageTargets } from '../src/client/ArkmeMessageTextSelection.js'
import { observeNativeTextTargets, insertNativeQuote } from '../src/client/harness-text-selection.js'
import { captureQuoteAnchor, quoteDigest, quoteHighlightRange } from '../src/client/message-quote-selection.js'
import { copyText } from '../src/client/clipboard-text.js'
import type { NativeChat } from '../src/client/harness-native-selection.js'
vi.mock('../src/client/clipboard-text.js', () => ({ copyText: vi.fn() }))
vi.mock('../src/client/api.js', () => ({ callArkme: vi.fn() }))
const source = JSON.stringify(['dsh-native', 11, 'session'])
const cleanups: (() => void | Promise<void>)[] = []
beforeEach(() => { vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); vi.stubGlobal('crypto', webcrypto)
  Range.prototype.getBoundingClientRect = () => new DOMRect(10, 60, 100, 20)
  Range.prototype.getClientRects = () => [new DOMRect(10, 60, 100, 20)] as unknown as DOMRectList
})
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); document.body.innerHTML = ''; vi.unstubAllGlobals(); vi.clearAllMocks() })
function fixture() {
  document.body.innerHTML = `<div id="toolbar"></div><div data-chat-flow>
    <div data-chat-anchor-key="u" data-chat-flow-kind="user"><div><span data-slot="conversation.user.text.node">用户正文</span></div><span>12:00</span><button>复制</button></div>
    <div data-chat-anchor-key="a" data-chat-node-key="a" data-chat-flow-kind="assistant-step" data-chat-group-part="response"><div class="_markdown_hash"><p>前缀<strong>重点</strong>后缀</p><pre><code>const a = 1</code></pre><button>复制代码</button></div></div>
    <div data-chat-anchor-key="tool" data-chat-flow-kind="tool-call">工具敏感内容</div>
  </div>`
  const nodes: Record<string, unknown> = {
    u: { key: 'u', kind: 'user', target: 'chat', visibility: 'visible', data: { content: [{ type: 'text', text: '用户正文' }] } },
    a: { key: 'a', kind: 'assistant-step', target: 'chat', visibility: 'visible', data: { status: 'settled', blocks: [{ kind: 'text', text: '**重点**' }] } },
  }
  const listeners = new Set<() => void>()
  const chat: NativeChat = { nodes: { get: key => nodes[key], source: () => ({ subscribe: fn => { listeners.add(fn); return () => listeners.delete(fn) } }) } }
  cleanups.push(observeNativeTextTargets(document, chat, source))
  return { nodes, listeners, row: document.querySelector<HTMLElement>('[data-chat-anchor-key="a"]')!, user: document.querySelector<HTMLElement>('[data-chat-anchor-key="u"]')! }
}
it('projects only prose, including Markdown and code, and anchors an exact selection', async () => {
  const { row } = fixture(), targets = registeredMessageTargets(source)
  expect(targets).toHaveLength(2)
  const target = targets.find(entry => entry.element === row)!.target
  expect(target.item.textContent).toBe('前缀重点后缀 const a = 1')
  expect(target.item.messageActionRef).toBeUndefined()
  const range = document.createRange(); range.selectNodeContents(row.querySelector('strong')!)
  const quote = { ...captureQuoteAnchor(row, range, '重点', target.item), sourceDigest: await quoteDigest(target.item) }
  expect(quoteHighlightRange(row, quote)?.toString()).toBe('重点')
  expect(quoteHighlightRange(row, { ...quote, text: '错误' })).toBeUndefined()
})
it('shows the shared toolbar on mouseup; right click keeps selection; Select All excludes time', async () => {
  const { user } = fixture(), root = createRoot(document.querySelector('#toolbar')!)
  cleanups.push(async () => { await act(async () => root.unmount()) })
  await act(async () => root.render(<ArkmeMessageTextSelectionToolbar selectionDomain="native" replySourceRef={source} replyLabel="引用" onReply={vi.fn()} onUnderline={async () => undefined} />))
  const range = document.createRange(), text = user.querySelector('span')!.firstChild!
  range.setStart(text, 0); range.setEnd(text, 2); document.getSelection()!.removeAllRanges(); document.getSelection()!.addRange(range)
  await act(async () => text.parentElement!.dispatchEvent(new MouseEvent('mouseup', { bubbles: true })))
  const menu = () => document.querySelector('[role="toolbar"]')!
  expect(menu().textContent).toBe('复制全选标记查找引用')
  const context = new MouseEvent('contextmenu', { bubbles: true, cancelable: true })
  await act(async () => text.parentElement!.dispatchEvent(context)); expect(context.defaultPrevented).toBe(true)
  await act(async () => (menu().querySelectorAll('button')[1] as HTMLButtonElement).click())
  expect(document.getSelection()!.toString()).toBe('用户正文')
  await act(async () => (menu().querySelector('button') as HTMLButtonElement).click())
  expect(copyText).toHaveBeenCalledWith('用户正文')
})
it('invalidates targets on changed content; streaming text remains selectable but cannot be marked', async () => {
  const f = fixture(), node = f.nodes.a as { data: { status: string } }
  node.data.status = 'streaming'; f.listeners.forEach(listener => listener())
  await new Promise(resolve => requestAnimationFrame(resolve))
  expect(registeredMessageTargets(source).map(entry => entry.target.item.itemUid)).toEqual(['u'])
  expect(f.row.hasAttribute('data-arkme-text-selection')).toBe(true)
  node.data.status = 'settled'; f.listeners.forEach(listener => listener())
  await new Promise(resolve => requestAnimationFrame(resolve))
  expect(registeredMessageTargets(source)).toHaveLength(2)
})
it('quotes without replacing selected draft text, preserves attachments and never submits', () => {
  const actions = { captureInsertion: () => ({ start: 0, end: 5, draftRev: 9 }), insertText: vi.fn(() => true), persistDraft: vi.fn(), setDraft: vi.fn(), submit: vi.fn() }
  insertNativeQuote(actions, '两行\n文字', '你')
  expect(actions.insertText).toHaveBeenCalledWith('\n\n> 引用你：\n> 两行\n> 文字\n\n', { start: 5, end: 5, draftRev: 9 })
  expect(actions.persistDraft).toHaveBeenCalledOnce(); expect(actions.setDraft).not.toHaveBeenCalled(); expect(actions.submit).not.toHaveBeenCalled()
  actions.insertText.mockReturnValue(false)
  expect(() => insertNativeQuote(actions, 'test', 'DSH')).toThrow('草稿已变化')
  expect(actions.persistDraft).toHaveBeenCalledTimes(1)
})
it('clamps the toolbar inside the visible conversation instead of the clipped iframe sidebar', async () => {
  const { user } = fixture(), root = createRoot(document.querySelector('#toolbar')!)
  cleanups.push(async () => { await act(async () => root.unmount()) })
  await act(async () => root.render(<ArkmeMessageTextSelectionToolbar selectionDomain="native" replySourceRef={source}
    getViewport={() => ({ left: 428, right: 900, top: 0, bottom: 720 })} />))
  const range = document.createRange(); range.selectNodeContents(user.querySelector('span')!)
  document.getSelection()!.removeAllRanges(); document.getSelection()!.addRange(range)
  await act(async () => user.querySelector('span')!.dispatchEvent(new MouseEvent('mouseup', { bubbles: true })))
  expect((document.querySelector('[role="toolbar"]') as HTMLElement).style.left).toBe('436px')
})
it('registers newly mounted prose synchronously on the first pointer interaction', () => {
  const f = fixture()
  const row = document.createElement('div'); row.dataset.chatAnchorKey = 'new'; row.dataset.chatFlowKind = 'user'
  row.innerHTML = '<span data-slot="conversation.user.text.node">新增正文</span>'
  f.nodes.new = { key: 'new', kind: 'user', target: 'chat', visibility: 'visible', data: { content: [{ type: 'text', text: '新增正文' }] } }
  document.querySelector('[data-chat-flow]')!.append(row)
  row.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
  expect(row.hasAttribute('data-arkme-text-selection')).toBe(true)
})
it('copies prose across an embedded code-copy button without its label', async () => {
  const { row } = fixture(), root = createRoot(document.querySelector('#toolbar')!)
  cleanups.push(async () => { await act(async () => root.unmount()) })
  row.querySelector('pre')!.insertAdjacentHTML('beforebegin', '<button>复制代码</button>')
  await act(async () => root.render(<ArkmeMessageTextSelectionToolbar selectionDomain="native" replySourceRef={source} />))
  const range = document.createRange(); range.setStart(row.querySelector('p')!.firstChild!, 0); range.setEnd(row.querySelector('code')!.firstChild!, 11)
  document.getSelection()!.removeAllRanges(); document.getSelection()!.addRange(range)
  await act(async () => row.querySelector('code')!.dispatchEvent(new MouseEvent('mouseup', { bubbles: true })))
  await act(async () => (document.querySelector('[role="toolbar"] button') as HTMLButtonElement).click())
  expect(vi.mocked(copyText).mock.calls[0]![0]).toBe('前缀重点后缀\nconst a = 1')
})
