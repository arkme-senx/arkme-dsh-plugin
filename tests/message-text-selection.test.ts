// @vitest-environment jsdom
import { afterEach, expect, it } from 'vitest'
import { captureMessageTextSelection } from '../src/client/message-text-selection.js'
import { arkmeDefaultEmojis } from '../src/client/arkme-emoji.js'

afterEach(() => { document.getSelection()!.removeAllRanges(); document.body.replaceChildren() })

function bubble(html: string) {
  const element = document.createElement('div')
  element.innerHTML = html
  document.body.append(element)
  return element
}
function select(start: Node, from: number, end = start, to = start.textContent!.length) {
  document.getSelection()!.setBaseAndExtent(start, from, end, to)
}

it.each([false, true])('captures only the selected characters, including backwards selection: %s', backwards => {
  const el = bubble('整条消息里的部分文字，其他不要')
  select(el.firstChild!, backwards ? 10 : 6, el.firstChild!, backwards ? 6 : 10)
  expect(captureMessageTextSelection(el)).toBe('部分文字')
  expect(document.getSelection()!.toString()).toBe('部分文字')
})

it('preserves whitespace and newlines instead of trimming or copying the whole message', () => {
  const el = bubble('前  第一行\n第二行  后')
  select(el.firstChild!, 1, el.firstChild!, 12)
  expect(captureMessageTextSelection(el)).toBe('  第一行\n第二行  ')
})

it('captures a selection spanning formatted text and links', () => {
  const el = bubble('<p>前缀<strong>加粗</strong><a href="https://example.com">链接</a>后缀</p>')
  select(el.querySelector('strong')!.firstChild!, 1, el.querySelector('a')!.firstChild!, 1)
  expect(captureMessageTextSelection(el)).toBe('粗链')
})

it('does not reuse a selection from another message, editor or outside the bubble', () => {
  const one = bubble('第一条消息'), two = bubble('第二条消息')
  select(one.firstChild!, 0)
  expect(captureMessageTextSelection(two)).toBeUndefined()
  select(one.firstChild!, 2, two.firstChild!, 3)
  expect(captureMessageTextSelection(two)).toBeUndefined()
  expect(captureMessageTextSelection(undefined)).toBeUndefined()
})

it('leaves the normal menu for empty or collapsed selections', () => {
  const el = bubble('   正文')
  expect(captureMessageTextSelection(el)).toBeUndefined()
  select(el.firstChild!, 1, el.firstChild!, 1)
  expect(captureMessageTextSelection(el)).toBeUndefined()
  select(el.firstChild!, 0, el.firstChild!, 3)
  expect(captureMessageTextSelection(el)).toBeUndefined()
})

it('copies emoji as unicode, skips read decorations and keeps paragraph / br boundaries', () => {
  const emoji = arkmeDefaultEmojis[0]!
  const el = bubble(`<p>@同事<span data-arkme-mention-read>已读</span><img data-arkme-rich-emoji="${emoji.id}"></p><p>第二行<br>第三行</p>`)
  select(el, 0, el, el.childNodes.length)
  expect(captureMessageTextSelection(el)).toBe(`@同事${emoji.unicode}\n第二行\n第三行`)
  expect(el.querySelector('[data-arkme-mention-read]')?.textContent).toBe('已读')
  expect(el.querySelector('img')).not.toBeNull()
})

it('keeps a plain snapshot when focus, selection and the original message change', () => {
  const el = bubble('原来选中的文字，其余不要')
  select(el.firstChild!, 2, el.firstChild!, 8)
  const snapshot = captureMessageTextSelection(el)
  document.getSelection()!.removeAllRanges()
  el.textContent = '新的整条消息'
  expect(snapshot).toBe('选中的文字，')
})
