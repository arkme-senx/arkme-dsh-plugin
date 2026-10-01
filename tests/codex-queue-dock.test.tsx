// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CodexQueueDock } from '../src/client/redesign/contacts/CodexQueueDock.js'
import { connectArkmeLocale } from '../src/client/locale.js'
import type { TeamCodexQueuedRequest, TeamCodexTask } from '../src/team-codex-contract.js'

const queued = (id = 'one', overrides: Partial<TeamCodexQueuedRequest> = {}): TeamCodexQueuedRequest => ({
  id, text: `需求 ${id}`, createdAt: 1, delivery: 'queue', state: 'queued', paused: false, attachmentCount: 0, truncated: false, ...overrides,
})
const taskWith = (items: TeamCodexQueuedRequest[] = []): TeamCodexTask => ({
  id: 'task', title: '测试任务', member: { userRef: 'self', displayName: '用户', identityState: 'ready', role: 'member', joinedAtMillis: 1 },
  status: 'active', state: 'working', updatedAt: Date.now(), eventCount: 1,
  queue: { version: 1, availability: 'ready', reason: 'none', checkedAt: Date.now(), changedAt: 1, sourceAt: 1, items },
})
let host: HTMLDivElement, root: Root
const render = (task: TeamCodexTask, key = task.id) => act(() => root.render(<CodexQueueDock task={task} key={key}/>))
const header = () => host.querySelector<HTMLButtonElement>('.arkme-codex-queue-header')
const rows = () => [...host.querySelectorAll('.arkme-codex-queue-row')]
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
})
afterEach(() => {
  act(() => { connectArkmeLocale({ getLocale: () => ({ active: 'zh' }), subscribe: () => () => {} })(); root.unmount() })
  host.remove(); vi.useRealTimers(); vi.unstubAllGlobals()
})

describe('DSH-style Codex queue dock', () => {
  it('renders nothing for a confirmed empty queue', () => {
    render(taskWith())
    expect(host.innerHTML).toBe('')
  })
  it('shows one item directly, without a count, duplicate preview or routine status', () => {
    render(taskWith([queued()]))
    expect(header()).toBeNull()
    expect(rows()).toHaveLength(1)
    expect(host.textContent).toBe('需求 one')
    expect(host.querySelectorAll('svg')).toHaveLength(1)
    expect(host.querySelector('[role="status"]')).toBeNull()
  })
  it('defaults multiple rows to one count header and opens all rows with one toggle', () => {
    render(taskWith(Array.from({ length: 8 }, (_, i) => queued(String(i)))))
    expect(header()?.textContent).toBe('8 条排队消息')
    expect(header()?.getAttribute('aria-expanded')).toBe('false')
    expect(rows()).toHaveLength(0)
    const list = host.querySelector('ul')!
    expect(list.hidden).toBe(true)
    expect(header()?.getAttribute('aria-controls')).toBe(list.id)
    act(() => header()!.click())
    expect(list.hidden).toBe(false)
    expect(rows().map(row => row.textContent)).toEqual(Array.from({ length: 8 }, (_, i) => `需求 ${i}`))
    expect(host.querySelectorAll('button')).toHaveLength(1)
    expect(host.textContent?.match(/需求 0/g)).toHaveLength(1)
    act(() => header()!.click())
    expect(rows()).toHaveLength(0)
  })
  it('keeps the open state across refreshes, shows a remaining single row, and resets after empty', () => {
    const task = taskWith([queued('a'), queued('b')])
    render(task); act(() => header()!.click())
    render({ ...task, queue: { ...task.queue!, items: [...task.queue!.items, queued('c')] } })
    expect(header()?.getAttribute('aria-expanded')).toBe('true')
    expect(rows()).toHaveLength(3)
    render(taskWith([queued('last')]))
    expect(header()).toBeNull(); expect(host.textContent).toBe('需求 last')
    render(taskWith()); expect(host.innerHTML).toBe('')
    render(task)
    expect(header()?.getAttribute('aria-expanded')).toBe('false')
  })
  it('defaults a different task to collapsed and never retains the other task text', () => {
    render(taskWith([queued('a'), queued('b')])); act(() => header()!.click())
    render({ ...taskWith([queued('c'), queued('d')]), id: 'other-task' })
    expect(header()?.getAttribute('aria-expanded')).toBe('false')
    expect(host.textContent).not.toContain('需求 a')
  })
  it.each(['partial', 'unavailable', 'stale', 'paused'] as const)('does not equate %s with an empty queue', availability => {
    const task = taskWith(); task.queue!.availability = availability
    render(task)
    expect(host.querySelector('[role="status"]')?.textContent).toBeTruthy()
    expect(host.textContent).not.toMatch(/暂无排队|0 条/)
  })
  it('labels stale data as a previous snapshot without duplicating its content', () => {
    const task = taskWith([queued('a'), queued('b')]); task.queue!.checkedAt = Date.now() - 16_000
    render(task)
    expect(header()?.textContent).toBe('上次队列 2 条')
    expect(host.textContent).toContain('队列状态待更新')
    act(() => header()!.click())
    expect(rows()).toHaveLength(2)
    expect(host.querySelector('.arkme-codex-queue-notice')?.getAttribute('title')).toContain('数量和顺序可能不完整')
  })
  it('does not let a stale snapshot warning hide an uncertain send outcome', () => {
    const task = taskWith([queued('a'), queued('b', { state: 'unknown' })]); task.queue!.availability = 'stale'
    render(task)
    expect(header()?.textContent).toContain('发送结果待确认')
    expect(host.textContent).toContain('队列状态待更新')
  })
  it.each(['paused', 'disconnected'] as const)('does not render retained requests on a %s task', status => {
    render({ ...taskWith([queued('private')]), status })
    expect(rows()).toHaveLength(0)
    expect(host.textContent).toBe('队列同步已暂停')
  })
  it('keeps a remote-only availability hint, not a fabricated empty or local queue', () => {
    render({ ...taskWith([queued('private')]), cloud: { taskId: 'remote', sourceId: 'device', sourceName: 'Laptop', ownerRef: 'self', remote: true } })
    expect(host.textContent).toBe('排队请求暂仅在来源电脑可见')
    expect(rows()).toHaveLength(0)
  })
  it.each([
    [{ state: 'unknown' }, '发送结果待确认'],
    [{ state: 'sending' }, '正在发送'],
    [{ paused: true }, '等待继续'],
    [{ delivery: 'send-now' }, '待发送'],
  ] as const)('retains a meaningful exceptional status for %o even when collapsed', (overrides, label) => {
    render(taskWith([queued('a'), queued('b', overrides)]))
    expect(header()?.textContent).toContain(label)
    act(() => header()!.click())
    expect(host.textContent?.split(label)).toHaveLength(2)
    expect(rows()[1]?.textContent).toContain(label)
  })
  it('preserves attachment-only requests and offers the full available text on hover', () => {
    const content = '非常长的需求 '.repeat(100)
    render(taskWith([queued('long', { text: content, truncated: true, attachmentCount: 2 })]))
    const preview = host.querySelector<HTMLElement>('.arkme-codex-queue-preview')!
    expect(preview.textContent).toBe(content)
    expect(preview.title).toBe(`${content} · 正文已截断`)
    expect(host.textContent).toContain('2 个附件')
    render(taskWith([queued('file', { text: '', attachmentCount: 1 })]))
    expect(host.textContent).toBe('无文本输入1 个附件')
  })
  it('localizes UI but never translates queued text', () => {
    act(() => connectArkmeLocale({ getLocale: () => ({ active: 'en' }), subscribe: () => () => {} })())
    render(taskWith([queued('a', { text: '用户原文' }), queued('b')]))
    expect(header()?.textContent).toBe('2 queued messages')
    act(() => header()!.click())
    expect(rows()[0]?.textContent).toBe('用户原文')
  })
})
