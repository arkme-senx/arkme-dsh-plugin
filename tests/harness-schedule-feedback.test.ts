// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { installHarnessScheduleFeedback } from '../src/client/harness-schedule-feedback.js'

const cleanups: Array<() => void> = []
afterEach(() => { cleanups.splice(0).forEach(fn => fn()); document.body.innerHTML = '' })
const flush = () => new Promise(resolve => setTimeout(resolve, 0))
function fixture(english = false) {
  const surface = document.createElement('div'), iframe = document.createElement('iframe')
  document.body.append(surface); surface.append(iframe)
  const doc = iframe.contentDocument!
  doc.body.innerHTML = `<ul aria-label="${english ? 'Active reminders' : '活动提醒'}"><li><span role="alert">${english ? 'Could not load reminders.' : '无法加载提醒。'}</span><button>重试</button></li></ul><p role="alert">其他失败</p>`
  const original = doc.querySelector<HTMLElement>('span[role="alert"]')!
  const retry = vi.fn(); doc.querySelector('button')!.addEventListener('click', retry)
  surface.setAttribute('data-arkme-schedule-error', 'RUNTIME_OFFLINE')
  const dispose = installHarnessScheduleFeedback(doc); cleanups.push(dispose)
  return { surface, doc, original, retry, dispose, notice: () => doc.querySelector('[data-arkme-schedule-notice]') }
}
it('keeps native retry functional and restores the original UI after recovery or cleanup', async () => {
  const f = fixture()
  expect(f.notice()?.textContent).toContain('源电脑未连接')
  expect(f.original.textContent).toBe('无法加载提醒。')
  f.doc.querySelector('button')!.click(); expect(f.retry).toHaveBeenCalledOnce()
  f.surface.removeAttribute('data-arkme-schedule-error'); await flush()
  expect(f.notice()).toBeNull(); expect(f.original.hasAttribute('data-arkme-schedule-failure')).toBe(false)
  f.surface.setAttribute('data-arkme-schedule-error', 'CAPABILITY_UNSUPPORTED'); await flush()
  expect(f.notice()?.textContent).toContain('更新源电脑')
  f.dispose()
  expect(f.notice()).toBeNull(); expect(f.doc.head.querySelector('style')).toBeNull()
  expect(f.doc.querySelector('p')!.textContent).toBe('其他失败')
})
it('does not hide a reused native node after its failure text changes', async () => {
  const f = fixture()
  f.original.textContent = '尚无提醒'; await flush()
  expect(f.notice()).toBeNull(); expect(f.original.hasAttribute('data-arkme-schedule-failure')).toBe(false)
})
it('handles English and task-detail failures while leaving unrelated alerts alone', async () => {
  const f = fixture(true)
  expect(f.notice()?.textContent).toContain('source computer is offline')
  f.doc.body.innerHTML = '<div data-slot="sidebar.right.pane.tab"><p role="alert">无法加载任务</p><p role="alert">其他失败</p></div>'
  f.surface.setAttribute('data-arkme-schedule-error', 'REMOTE_TRANSPORT_FAILED'); await flush()
  expect(f.notice()?.textContent).toBe('提醒读取失败，请重试。')
  expect(f.doc.querySelectorAll('[data-arkme-schedule-failure]')).toHaveLength(1)
})
