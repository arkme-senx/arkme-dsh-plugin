// @vitest-environment jsdom
import { webcrypto } from 'node:crypto'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { ArkmeArkoSurface } from '../src/client/ArkmeArkoSurface.js'
import { registeredMessageTargets } from '../src/client/ArkmeMessageTextSelection.js'
import { arkoMessageMarkTarget, arkoMessageMarkTransport } from '../src/client/arko-message-marks.js'
import { callArkme } from '../src/client/api.js'
import { arkmeAuthStore } from '../src/client/auth-store.js'
import { arkoModelCache } from '../src/client/arko-model-cache.js'
import { arkmeArkoProfileStore } from '../src/client/arko-profile-store.js'
import { arkmeComposerDraftStore } from '../src/client/composer-draft-store.js'
import type { ArkmeArkoHistoryItem } from '../src/types.js'
import type { MessageUnderlineChange, MessageUnderlineSnapshot } from '../src/message-annotations.js'

vi.mock('../src/client/api.js', async original => ({ ...await original<typeof import('../src/client/api.js')>(), callArkme: vi.fn() }))
let root: Root, host: HTMLDivElement, history: ArkmeArkoHistoryItem[]
const highlights = new Map<string, Set<Range>>()
const saved = new Map<string, MessageUnderlineSnapshot>()
const originalRects = Object.getOwnPropertyDescriptor(Range.prototype, 'getClientRects')
const originalPoint = document.elementFromPoint
const empty = (): MessageUnderlineSnapshot => ({ revision: 0, accessible: true, items: [] })
const item = (id: number, role: 'user' | 'assistant', text: string): ArkmeArkoHistoryItem => ({
  messageId: id, sessionId: 88, role, text, localMarkRef: `mark-${id}`, reasoning: '',
  createdAtMillis: 1786000000000 + id * 1000, status: 1, createdRecordUids: [],
})
const body = (id: number) => host.querySelector<HTMLElement>(`[data-arko-selection-key="history:${id}"] [data-arkme-text-selection]`)!
const toolbar = () => document.querySelector('[role="toolbar"][aria-label="选中文字操作"]')
const markedTexts = () => [...highlights.values()].flatMap(ranges => [...ranges].map(range => range.toString()))
const click = async (element: Element) => { await act(async () => { element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })) }) }
async function waitForUi(check: () => void) {
  await vi.waitFor(async () => { await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)) }); check() })
}
async function select(element: HTMLElement, phrase: string) {
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT)
  let node = walker.nextNode()
  while (node && !node.textContent?.includes(phrase)) node = walker.nextNode()
  expect(node).not.toBeNull()
  const start = node!.textContent!.indexOf(phrase)
  await act(async () => {
    const range = document.createRange(); range.setStart(node!, start); range.setEnd(node!, start + phrase.length)
    document.getSelection()!.removeAllRanges(); document.getSelection()!.addRange(range)
    element.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, clientX: 30, clientY: 55 }))
  })
  await waitForUi(() => expect(toolbar()).not.toBeNull())
}
async function mark() {
  await click([...toolbar()!.querySelectorAll('button')].find(button => button.textContent === '标记')!)
}
beforeEach(async () => {
  arkoModelCache.clear(); highlights.clear(); saved.clear()
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); vi.stubGlobal('crypto', webcrypto)
  vi.stubGlobal('CSS', { highlights }); vi.stubGlobal('Highlight', class extends Set<Range> { constructor(...ranges: Range[]) { super(ranges) } })
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} })
  vi.spyOn(window, 'scrollBy').mockImplementation(() => {})
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(new DOMRect(20, 50, 200, 60))
  Range.prototype.getClientRects = () => [new DOMRect(20, 50, 100, 20)] as unknown as DOMRectList
  document.elementFromPoint = () => null
  arkmeArkoProfileStore.activateUser(undefined)
  arkmeAuthStore.setAuth({ status: 'authenticated', environment: 'test', userId: 10001 })
  history = [item(1, 'user', '我的问题需要保留'), item(2, 'assistant', '这是 **重点结论**，以及[链接](https://example.com)。')]
  vi.mocked(callArkme).mockImplementation(async (method, params) => {
    if (method === 'arko.session') return { sessionId: 88 } as never
    if (method === 'arko.messages') return { items: history } as never
    if (method === 'arko.models') return { options: [] } as never
    if (method === 'arko.profile') return { displayName: 'Arko', version: 2 } as never
    if (method === 'user.profile') return { profile: {} } as never
    if (method === 'arko.local-mark.capabilities') return { supported: true, storage: 'local', maxLength: 2000 } as never
    const input = params as { markRefs: string[]; markRef: string; change: MessageUnderlineChange }
    if (method === 'arko.local-mark.list') return input.markRefs.map(ref => ({ actionRef: ref, snapshot: saved.get(ref) ?? empty() })) as never
    if (method === 'arko.local-mark.change') {
      const previous = saved.get(input.markRef) ?? empty(), change = input.change
      const next: MessageUnderlineSnapshot = { revision: previous.revision + 1, accessible: true,
        items: change.kind === 'remove' ? previous.items.filter(mark => mark.id !== change.annotationId)
          : [...previous.items, { id: change.operationId, actorId: 10001, actorName: '你', mine: true, anchor: change.anchor, state: 'available' }] }
      saved.set(input.markRef, next)
      return next as never
    }
    throw new Error(`unexpected ${method}`)
  })
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
  await act(async () => { root.render(<ArkmeArkoSurface />) })
})
afterEach(async () => {
  await act(async () => root.unmount()); host.remove(); document.getSelection()?.removeAllRanges()
  arkmeArkoProfileStore.activateUser(undefined); arkmeComposerDraftStore.clearAccount(10001)
  document.elementFromPoint = originalPoint
  if (originalRects) Object.defineProperty(Range.prototype, 'getClientRects', originalRects)
  else delete (Range.prototype as Partial<Range>).getClientRects
  vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.clearAllMocks()
})

it('marks both roles, preserves rendered Markdown, and restores the same local marks after remount', async () => {
  await select(body(1), '我的问题')
  expect(toolbar()!.textContent).toContain('仅本机')
  expect([...toolbar()!.querySelectorAll('button')].map(button => button.textContent)).toEqual(['复制', '全选', '标记'])
  await mark()
  await waitForUi(() => expect(markedTexts()).toContain('我的问题'))
  await select(body(2), '重点结论'); await mark()
  await waitForUi(() => expect(markedTexts()).toContain('重点结论'))
  expect(body(2).querySelector('strong')?.textContent).toBe('重点结论')
  expect(saved.get('mark-2')?.items[0]?.anchor).toMatchObject({ text: '重点结论', start: 3, end: 7 })
  expect(body(2).querySelector('a')?.getAttribute('href')).toBe('https://example.com')
  await act(async () => root.unmount()); root = createRoot(host)
  await act(async () => { root.render(<ArkmeArkoSurface />) })
  await waitForUi(() => expect(markedTexts()).toEqual(expect.arrayContaining(['我的问题', '重点结论'])))
  expect(vi.mocked(callArkme).mock.calls.some(([method]) => method.startsWith('source.message-underline'))).toBe(false)
})

it('shares detail and bubble marks and cancels by clicking highlighted text without closing details', async () => {
  await click(body(2))
  const detail = host.querySelector<HTMLElement>('[aria-label="消息详情"]')!
  await select(detail.querySelector<HTMLElement>('[data-arkme-text-selection]')!, '重点结论'); await mark()
  await waitForUi(() => expect(markedTexts().filter(text => text === '重点结论')).toHaveLength(2))
  await act(async () => {
    const content = detail.querySelector('[data-arkme-text-selection]')!
    content.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: 30, clientY: 55 }))
    content.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, clientX: 30, clientY: 55 }))
  })
  expect(toolbar()!.textContent).toContain('取消标记')
  await click(toolbar()!.querySelector('[aria-pressed="true"]')!)
  await waitForUi(() => expect(markedTexts()).toHaveLength(0))
  expect(saved.get('mark-2')?.items).toHaveLength(0)
  expect(detail.isConnected).toBe(true)
})

it('enables marking a newly completed synchronous reply without reloading or moving the viewport', async () => {
  const original = vi.mocked(callArkme).getMockImplementation()!
  vi.mocked(callArkme).mockImplementation(async (method, params, signal) => {
    if (method === 'arko.ask') {
      history = [...history, item(3, 'user', '你能帮我干什么'), item(4, 'assistant', '新回复可以标记')]
      return { sessionId: 88, userMsgId: 3, assistantMsgId: 4, status: 'completed', text: '新回复可以标记', reasoning: '', createdRecordUids: [] } as never
    }
    return original(method, params, signal)
  })
  await click(host.querySelector('[aria-label="更多 Arko 操作"]')!)
  await click([...document.querySelectorAll('[role="menu"] button')].find(node => node.textContent === 'Arko 能干什么')!)
  await waitForUi(() => expect(registeredMessageTargets('arko:test:10001').some(({ target }) => target.localMarkRef === 'mark-4')).toBe(true))
  const viewport = host.querySelector<HTMLElement>('[data-arko-message-viewport]')!
  Object.defineProperty(viewport, 'scrollHeight', { value: 1000 })
  Object.defineProperty(viewport, 'clientHeight', { value: 300 })
  await act(async () => {
    viewport.scrollTop = 145
    viewport.dispatchEvent(new Event('scroll', { bubbles: true }))
  })
  await select(body(4), '新回复'); await mark()
  await waitForUi(() => expect(saved.get('mark-4')?.items[0]?.anchor.text).toBe('新回复'))
  expect(viewport.scrollTop).toBe(145)
})

it('does not authorize streaming text or leak the target into ordinary reply handling', () => {
  const message = { messageId: 2, sessionId: 88, localMarkRef: 'ref', role: 'assistant', status: 'sending', text: '生成中' }
  expect(arkoMessageMarkTarget(message, 'arko:test:10001')).toBeUndefined()
  const target = arkoMessageMarkTarget({ ...message, status: 'done' }, 'arko:test:10001')!
  expect(target.item.messageActionRef).toBeUndefined()
  expect(arkoMessageMarkTarget({ ...message, status: 'done' }, undefined)).toBeUndefined()
})

it('splits long reference reads to keep every local request within the host body limit', async () => {
  const refs = ['a'.repeat(600_000), 'b'.repeat(600_000), 'c']
  const rows = await arkoMessageMarkTransport.list('arko:test:10001', refs, new AbortController().signal)
  expect(rows.map(row => row.actionRef)).toEqual(refs)
  const reads = vi.mocked(callArkme).mock.calls.filter(([method, params]) => method === 'arko.local-mark.list' && (params as { markRefs: string[] }).markRefs.includes(refs[0]!))
  expect((reads[0]![1] as { markRefs: string[] }).markRefs).toEqual([refs[0]])
})
