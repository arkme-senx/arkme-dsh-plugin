// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import { ArkmeDetailShell } from '../src/client/ArkmeDetailShell.js'
let root: Root
let host: HTMLDivElement
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
})
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals() })
it('preserves legacy record slots, resize label and back focus', async () => {
  const back = vi.fn()
  await act(async () => { root.render(<ArkmeDetailShell title="快记详情" label="快记详情" subtitle="日期" onClose={() => {}} onBack={back} backLabel="返回快记详情" footer={<input aria-label="原有扩展输入" />}><p>记录业务内容</p></ArkmeDetailShell>) })
  expect(host.textContent).toContain('记录业务内容')
  expect(host.textContent).toContain('日期')
  expect(host.querySelector('[aria-label="原有扩展输入"]')).not.toBeNull()
  expect(host.querySelector('[aria-label="调整快记详情宽度"]')).not.toBeNull()
  expect(document.activeElement?.getAttribute('aria-label')).toBe('返回快记详情')
  await act(async () => { (document.activeElement as HTMLElement).click() })
  expect(back).toHaveBeenCalledTimes(1)
})
it('uses latest close callback and removes its Escape listener on unmount', async () => {
  const first = vi.fn(), latest = vi.fn()
  const render = async (close: () => void) => act(async () => { root.render(<ArkmeDetailShell title="消息详情" label="消息详情" onClose={close}>正文</ArkmeDetailShell>) })
  await render(first); await render(latest)
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', cancelable: true }))
  expect(first).not.toHaveBeenCalled(); expect(latest).toHaveBeenCalledTimes(1)
  await act(async () => { root.render(null) })
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', cancelable: true }))
  expect(latest).toHaveBeenCalledTimes(1)
})
it('does not steal focus back after the user moves to another control', async () => {
  const elsewhere = document.createElement('button'); document.body.append(elsewhere)
  await act(async () => { root.render(<ArkmeDetailShell title="详情" label="详情" onClose={() => {}}>正文</ArkmeDetailShell>) })
  elsewhere.focus()
  await act(async () => { root.render(null) })
  expect(document.activeElement).toBe(elsewhere)
  elsewhere.remove()
})
