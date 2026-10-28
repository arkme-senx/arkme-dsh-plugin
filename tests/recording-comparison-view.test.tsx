// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
import { RecordingComparisonView, RecordingComparisonRow, RecordingComparisonPane } from '../src/client/recordings/RecordingComparisonView.js'

let root: Root | undefined
afterEach(async () => { await act(async () => root?.unmount()); root = undefined; document.body.replaceChildren() })
async function render(ui: React.ReactNode) {
  const host = document.createElement('div'); document.body.append(host); root = createRoot(host)
  await act(async () => root!.render(ui))
}
it('keeps keyboard focus inside the comparison including source selection and restores focus on close', async () => {
  const origin = document.createElement('button'); document.body.append(origin); origin.focus()
  const close = vi.fn()
  await render(<RecordingComparisonView scope="单个音频 · 完整文件名.wav" onClose={close} notices={<select aria-label="源件"><option>一</option></select>}><button>末尾操作</button></RecordingComparisonView>)
  const closeButton = document.querySelector<HTMLButtonElement>('[aria-label="关闭转写对比"]')!
  expect(document.querySelector('[role="dialog"]')?.parentElement).toBe(document.body)
  const last = Array.from(document.querySelectorAll('button')).at(-1)!
  expect(document.activeElement).toBe(closeButton)
  closeButton.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true }))
  expect(document.activeElement).toBe(last)
  last.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }))
  expect(document.activeElement).toBe(closeButton)
  closeButton.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
  expect(close).toHaveBeenCalledOnce()
  await act(async () => root!.unmount()); root = undefined
  expect(document.activeElement).toBe(origin)
})

it('preserves text selection on one click and uses explicit double click or keyboard to play', async () => {
  const play = vi.fn()
  await render(<RecordingComparisonRow speaker="说话人 1" colorIndex={0} startAtMillis={1000} endAtMillis={1400} text="完整正文" active={false} playLabel="播放发言" onPlay={play} />)
  const row = document.querySelector<HTMLElement>('[data-transcript-time]')!
  row.click(); expect(play).not.toHaveBeenCalled()
  row.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))
  row.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))
  expect(play).toHaveBeenCalledTimes(2)
  expect(row.textContent).toContain('<1秒')
})

it('includes collapsed processing details in the dialog keyboard loop', async () => {
  await render(<RecordingComparisonView scope="当天录音" onClose={() => {}}><details><summary>处理详情</summary><p>已完成</p></details></RecordingComparisonView>)
  const close = document.querySelector<HTMLButtonElement>('[aria-label="关闭转写对比"]')!
  const summary = document.querySelector('summary')!
  close.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true }))
  expect(document.activeElement).toBe(summary)
  summary.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }))
  expect(document.activeElement).toBe(close)
})

it('keeps keyboard dismissal and navigation working when a completed action removes the focused button', async () => {
  const close = vi.fn()
  const view = (processing: boolean) => <RecordingComparisonView scope="当天录音" onClose={close}>
    {processing && <button>开始处理</button>}
    <button>播放结果</button>
  </RecordingComparisonView>
  await render(view(true))
  const action = Array.from(document.querySelectorAll('button')).find(button => button.textContent === '开始处理')!
  action.focus()
  await act(async () => root!.render(view(false)))
  expect(document.activeElement).toBe(document.body)
  document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
  expect(close).toHaveBeenCalledOnce()
  document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }))
  expect(document.activeElement).toBe(document.querySelector('[aria-label="关闭转写对比"]'))
  await act(async () => root!.unmount()); root = undefined
  document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
  expect(close).toHaveBeenCalledOnce()
})

it('scrolls each column independently and paginates only the column near its bottom', async () => {
  const next = [vi.fn().mockResolvedValue(undefined), vi.fn().mockResolvedValue(undefined)]
  await render(<>{[[1000, 4000], [500, 2500, 4100]].map((times, index) => <RecordingComparisonPane key={index} pagination={{ cursor: 'next', loading: false, error: '', next: next[index]! }}>
    {times.map(time => <div key={time} data-transcript-time={time}>{time}</div>)}
  </RecordingComparisonPane>)}</>)
  const left = document.querySelector('[data-transcript-time="1000"]')!.parentElement!
  const right = document.querySelector('[data-transcript-time="500"]')!.parentElement!
  for (const pane of [left, right]) {
    Object.defineProperties(pane, { scrollHeight: { value: 1000 }, clientHeight: { value: 100 } })
  }
  left.scrollTop = 600; right.scrollTop = 80
  await act(async () => { left.dispatchEvent(new Event('scroll')) })
  expect(right.scrollTop).toBe(80)
  expect(next[0]).toHaveBeenCalledOnce()
  expect(next[1]).not.toHaveBeenCalled()
  right.scrollTop = 650
  await act(async () => { right.dispatchEvent(new Event('scroll')) })
  expect(left.scrollTop).toBe(600)
  expect(next[1]).toHaveBeenCalledOnce()
  await act(async () => { left.dispatchEvent(new Event('scroll')); right.dispatchEvent(new Event('scroll')) })
  expect(next[0]).toHaveBeenCalledOnce()
  expect(next[1]).toHaveBeenCalledOnce()
})
