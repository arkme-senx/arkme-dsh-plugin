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
it('replaces the title row with a compact author block while keeping close and accessible label', async () => {
  const close = vi.fn()
  await act(async () => root.render(<ArkmeDetailShell title="快记详情" label="快记详情"
    headerContent={<div data-arkme-detail-author>何宏顺<small>2026年9月18日 18:04</small></div>}
    onClose={close}><p>正文内容</p></ArkmeDetailShell>))
  const panel = host.querySelector('[role="dialog"]')!
  expect(panel.getAttribute('aria-label')).toBe('快记详情')
  expect(panel.hasAttribute('aria-labelledby')).toBe(false)
  expect(panel.querySelector('h3')).toBeNull()
  expect(panel.textContent).not.toContain('快记详情')
  expect(panel.querySelector('header [data-arkme-detail-author]')).not.toBeNull()
  expect(panel.querySelectorAll('[data-arkme-detail-author]')).toHaveLength(1)
  await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="关闭详情"]')!.click())
  expect(close).toHaveBeenCalledOnce()
})
it('does not steal focus back after the user moves to another control', async () => {
  const elsewhere = document.createElement('button'); document.body.append(elsewhere)
  await act(async () => { root.render(<ArkmeDetailShell title="详情" label="详情" onClose={() => {}}>正文</ArkmeDetailShell>) })
  elsewhere.focus()
  await act(async () => { root.render(null) })
  expect(document.activeElement).toBe(elsewhere)
  elsewhere.remove()
})
it('keeps the footer mounted and focuses back when a history subview opens', async () => {
  const footer = <input aria-label="保留草稿" defaultValue="未发送" />
  await act(async () => root.render(<ArkmeDetailShell title="详情" label="详情" onClose={() => {}} footer={footer}>正文</ArkmeDetailShell>))
  const input = host.querySelector('input')
  await act(async () => root.render(<ArkmeDetailShell title="历史" label="历史" onClose={() => {}} onBack={() => {}} backLabel="返回详情" footer={footer} footerHidden>历史正文</ArkmeDetailShell>))
  expect(host.querySelector('input')).toBe(input)
  expect(host.querySelector('footer')?.hidden).toBe(true)
  expect(document.activeElement?.getAttribute('aria-label')).toBe('返回详情')
})
it('returns focus to the original trigger after opening and closing a subview', async () => {
  const trigger = document.createElement('button'); document.body.append(trigger); trigger.focus()
  await act(async () => root.render(<ArkmeDetailShell title="详情" label="详情" onClose={() => {}}>正文</ArkmeDetailShell>))
  await act(async () => root.render(<ArkmeDetailShell title="历史" label="历史" onClose={() => {}} onBack={() => {}}>历史</ArkmeDetailShell>))
  await act(async () => root.render(null))
  expect(document.activeElement).toBe(trigger)
  trigger.remove()
})

it('keeps keyboard focus in the detail after the back button disappears', async () => {
  const render = async (history: boolean) => act(async () => root.render(<ArkmeDetailShell title="详情" label="详情" onClose={() => {}}
    {...(history ? { onBack: () => {}, backLabel: '返回详情' } : {})}>内容</ArkmeDetailShell>))
  await render(false); await render(true)
  expect(document.activeElement?.getAttribute('aria-label')).toBe('返回详情')
  await render(false)
  expect(document.activeElement?.getAttribute('aria-label')).toBe('关闭详情')
})
it('does not steal external focus when a subview is dismissed programmatically', async () => {
  const elsewhere = document.createElement('button'); document.body.append(elsewhere)
  await act(async () => root.render(<ArkmeDetailShell title="历史" label="历史" onClose={() => {}} onBack={() => {}}>历史</ArkmeDetailShell>))
  elsewhere.focus()
  await act(async () => root.render(<ArkmeDetailShell title="详情" label="详情" onClose={() => {}}>正文</ArkmeDetailShell>))
  expect(document.activeElement).toBe(elsewhere)
  elsewhere.remove()
})
