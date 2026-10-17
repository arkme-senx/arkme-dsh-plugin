// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it, vi } from 'vitest'
import { ArkmeMarkdownBody } from '../src/client/ArkmeMarkdownBody.js'

it('preserves paragraph nodes, selection and scroll during unrelated parent renders', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  const host = document.createElement('div'); document.body.append(host)
  const root = createRoot(host)
  try {
    const ui = (text = '这是一段未改变的日总结。') => <ArkmeMarkdownBody text={text} highlightMentions={false} textStyle={{ fontSize: 14, lineHeight: 1.75 }} />
    await act(async () => root.render(ui()))
    const paragraph = host.querySelector('p')!
    const range = document.createRange(); range.selectNodeContents(paragraph)
    document.getSelection()!.removeAllRanges(); document.getSelection()!.addRange(range)
    const selection = document.getSelection()!.toString()
    host.scrollTop = 320
    for (let i = 0; i < 5; i++) await act(async () => root.render(ui()))
    expect(host.querySelector('p')).toBe(paragraph)
    expect(paragraph.isConnected).toBe(true)
    expect(document.getSelection()!.toString()).toBe(selection)
    expect(host.scrollTop).toBe(320)
    await act(async () => root.render(ui('后端实际返回了新的正文。')))
    expect(host.textContent).toContain('后端实际返回了新的正文。')
    expect(host.querySelector('p')).toBe(paragraph)
  } finally { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals() }
})

it('updates link behavior when the caller supplies a new renderer', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  const host = document.createElement('div'); const root = createRoot(host)
  try {
    await act(async () => root.render(<ArkmeMarkdownBody text="[原文](https://example.com)" renderLink={() => <button>旧操作</button>} />))
    await act(async () => root.render(<ArkmeMarkdownBody text="[原文](https://example.com)" renderLink={() => <button>新操作</button>} />))
    expect(host.textContent).toContain('新操作')
    expect(host.textContent).not.toContain('旧操作')
  } finally { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals() }
})
