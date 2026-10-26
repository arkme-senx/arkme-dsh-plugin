// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { DeepSeekHarnessRow } from '../src/client/ArkmeVirtualWorkspace.js'
import { HARNESS_ACTIVITY_ATTRIBUTE, HARNESS_ACTIVITY_EVENT } from '../src/client/harness-activity.js'

let host: HTMLDivElement
let root: Root
let surface: HTMLElement

const activity = (value: Record<string, unknown>) => {
  surface.setAttribute(HARNESS_ACTIVITY_ATTRIBUTE, JSON.stringify({ scope: 'acct-1', running: [], unread: [], pending: [], ...value }))
  document.dispatchEvent(new Event(HARNESS_ACTIVITY_EVENT))
}
const line = (selector: string) => host.querySelector(selector)?.textContent ?? ''
const row = () => host.querySelector('button')!

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  surface = document.createElement('section')
  surface.setAttribute('data-arkme-owned', 'deepseek-harness-surface')
  document.body.append(surface)
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})

afterEach(async () => {
  await act(async () => { root.unmount() })
  host.remove(); surface.remove()
  vi.unstubAllGlobals()
})

const render = async () => {
  await act(async () => {
    root.render(<DeepSeekHarnessRow selected={false} hoverEnabled={false} accountScope="acct-1" onClick={vi.fn()} />)
  })
}

it('uses the product conversation name instead of the current task on the first line', async () => {
  activity({ current: { id: 's1', title: '插件开发分支选择' } })
  await render()
  expect(line('[data-arkme-harness-title]')).toBe('DeepSeek Harness')
  expect(line('[data-arkme-harness-destination]')).toBe('你的 DeepSeek 智能助手')
  expect(row().getAttribute('aria-label')).toBe('DeepSeek Harness')
})

it('keeps the conversation name visible while a task is running', async () => {
  activity({ current: { id: 's1', title: '插件开发分支选择' }, running: [{ id: 's2', title: '另一个任务' }] })
  await render()
  // The running status must not push the conversation name out of the row.
  expect(line('[data-arkme-harness-title]')).toBe('DeepSeek Harness')
  expect(line('[data-arkme-harness-summary]')).toContain('1 进行中')
  expect(line('[data-arkme-harness-destination]')).toBe('')
  expect(row().getAttribute('aria-label')).toBe('DeepSeek Harness，1 进行中')
})

it('keeps pending and unread work as a badge-only signal without a running task', async () => {
  activity({ current: { id: 's1', title: '插件开发分支选择' }, unread: [{ id: 's2', title: '未读会话' }] })
  await render()
  // Documented contract: only a running task claims the second line; pending and
  // unread stay on the avatar badge, and the name is now always on line one.
  expect(line('[data-arkme-harness-title]')).toBe('DeepSeek Harness')
  expect(line('[data-arkme-harness-summary]')).toBe('')
  expect(line('[data-arkme-harness-destination]')).toBe('你的 DeepSeek 智能助手')
  expect(host.querySelector('[data-arkme-harness-badge]')?.textContent).toBe('1')
})

it('falls back to the product name before the harness reports a session', async () => {  await render()
  expect(line('[data-arkme-harness-title]')).toBe('DeepSeek Harness')
  expect(row().getAttribute('aria-label')).toBe('DeepSeek Harness')
})

it('keeps the product name for a blank harness session and after session changes', async () => {
  activity({ current: null })
  await render()
  expect(line('[data-arkme-harness-title]')).toBe('DeepSeek Harness')
  await act(async () => activity({ current: { id: 's2', title: '新任务' } }))
  expect(line('[data-arkme-harness-title]')).toBe('DeepSeek Harness')
})

it('shows the latest conversation title only when idle and fully read, and updates without changing selection', async () => {
  activity({ current: { id: 'old', title: '当前看的旧会话' }, recent: { id: 'recent', title: '最新对话标题' } })
  await render()
  expect(line('[data-arkme-harness-title]')).toBe('DeepSeek Harness')
  expect(line('[data-arkme-harness-destination]')).toBe('最新对话标题')
  expect(row().getAttribute('aria-label')).toBe('DeepSeek Harness，最新对话标题')
  expect(host.querySelector('[data-arkme-harness-destination]')?.getAttribute('title')).toBe('最新对话标题')
  await act(async () => activity({ current: { id: 'old', title: '另一个旧会话' }, recent: { id: 'recent', title: '最近对话已改名' } }))
  expect(line('[data-arkme-harness-destination]')).toBe('最近对话已改名')
})

it.each(['running', 'pending', 'unread'])('preserves %s attention ahead of the idle title', async kind => {
  activity({ recent: { id: 'recent', title: '最近对话' }, [kind]: [{ id: 'active', title: '需要关注的任务' }] })
  await render()
  expect(line('[data-arkme-harness-destination]')).not.toBe('最近对话')
  expect(host.querySelector('[data-arkme-harness-badge]')?.textContent).toBe('1')
})
