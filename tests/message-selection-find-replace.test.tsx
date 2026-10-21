// @vitest-environment jsdom
import { act, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { ArkmeMessageTextSelectionToolbar, ArkmeSelectableMessageText } from '../src/client/ArkmeMessageTextSelection.js'
import { useSelectedMessageSearch } from '../src/client/message-selection-search.js'
import type { PrepareSelectedTextReplace } from '../src/client/ArkmeSelectedTextReplace.js'
import type { ArkmeTimelineItem } from '../src/types.js'
vi.mock('../src/client/message-quote-selection.js', async original => ({ ...await original<typeof import('../src/client/message-quote-selection.js')>(), quoteDigest: async () => 'a'.repeat(64) }))
let root: Root, host: HTMLDivElement
const prepare = vi.fn<PrepareSelectedTextReplace>(), save = vi.fn<(value: string) => Promise<void>>()
function Fixture({ own = true, scope = 'one' }: { own?: boolean; scope?: string }) {
  const [search, setSearch] = useState('')
  useSelectedMessageSearch(scope, setSearch)
  const item = { itemUid: 'record', title: '', textContent: '前词 后词', status: 1, isMe: own, messageActionRef: 'message' } as ArkmeTimelineItem
  return <><ArkmeMessageTextSelectionToolbar replySourceRef="one" canReplace={target => target.item.isMe} prepareReplace={prepare} />
    <ArkmeSelectableMessageText text={item.textContent} target={{ item, sourceRef: 'one' }}><p>{item.textContent}</p></ArkmeSelectableMessageText>
    <output>{search}</output></>
}
async function show() {
  const p = host.querySelector('p')!, range = document.createRange()
  range.setStart(p.firstChild!, 3); range.setEnd(p.firstChild!, 5)
  await act(async () => { document.getSelection()!.removeAllRanges(); document.getSelection()!.addRange(range); p.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, button: 0 })) })
}
const click = async (text: string) => { await act(async () => [...document.querySelectorAll('button')].find(button => button.textContent === text)!.click()) }
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  Range.prototype.getBoundingClientRect = () => new DOMRect(50, 100, 180, 20)
  Range.prototype.getClientRects = () => [new DOMRect(50, 100, 180, 20)] as unknown as DOMRectList
  prepare.mockReset().mockResolvedValue({ save }); save.mockReset().mockResolvedValue(undefined)
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
})
afterEach(async () => { await act(async () => root.unmount()); host.remove(); document.getSelection()?.removeAllRanges(); vi.unstubAllGlobals() })
it('opens the current conversation search with exactly the selected words', async () => {
  await act(async () => root.render(<Fixture />)); await show(); await click('查找')
  expect(host.querySelector('output')!.textContent).toBe('后词')
  expect(document.querySelector('[role="toolbar"]')).toBeNull()
})
it('does not search another conversation or expose replacement for someone else', async () => {
  await act(async () => root.render(<Fixture own={false} scope="another" />)); await show()
  expect([...document.querySelectorAll('button')].some(button => button.textContent === '替换')).toBe(false)
  await click('查找'); expect(host.querySelector('output')!.textContent).toBe('')
  expect(document.querySelector('[role="alert"]')!.textContent).toContain('暂不支持')
})
it('focuses replacement input, preserves exact range and retains input after failure', async () => {
  save.mockRejectedValueOnce(new Error('网络失败，输入已保留'))
  await act(async () => root.render(<Fixture />)); await show(); await click('替换')
  expect(prepare).toHaveBeenCalledWith(expect.objectContaining({ sourceRef: 'one' }), expect.objectContaining({ start: 3, end: 5, text: '后词' }), expect.any(AbortSignal))
  const input = document.querySelector('textarea')!
  expect(document.activeElement).toBe(input)
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(input, '新词')
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
  await click('替换')
  expect(save).toHaveBeenCalledWith('新词'); expect(input.value).toBe('新词')
  expect(document.querySelector('[role="alert"]')!.textContent).toContain('网络失败')
  await click('替换'); expect(document.querySelector('[role="toolbar"]')).toBeNull()
})
it('cancels without saving and aborts a pending original-text read', async () => {
  prepare.mockImplementation(() => new Promise(() => {}))
  await act(async () => root.render(<Fixture />)); await show(); await click('替换')
  const signal = prepare.mock.calls[0]![2]
  await click('取消'); expect(signal.aborted).toBe(true); expect(save).not.toHaveBeenCalled()
})
