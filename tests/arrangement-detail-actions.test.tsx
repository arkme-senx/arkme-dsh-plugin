// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { ArkmeArrangementItem } from '../src/types.js'

const api = vi.hoisted(() => vi.fn())
vi.mock('../src/client/api.js', () => ({ callArkme: api }))
vi.mock('../src/client/ui-controller.js', () => ({ arkmeUi: { openDshSettings: vi.fn() } }))
vi.mock('../src/client/ArkmeArrangementContent.js', () => ({ ArkmeArrangementContent: () => <div>创建原文</div> }))
vi.mock('../src/client/arrangement-completion-sound.js', () => ({ prepareArrangementCompletionSound: () => ({ play() {}, cancel() {} }) }))
import { ArkmeArrangementWorkspace } from '../src/client/ArkmeArrangementWorkspace.js'

let host: HTMLDivElement, root: Root, records: ArkmeArrangementItem[], scope = 0
const makeItem = (arrangementRef = 'one', fields: Partial<ArkmeArrangementItem> = {}): ArkmeArrangementItem => ({
  arrangementRef, title: '与客户确认最终报价', description: '核对报价和付款节点', status: 'following',
  reminderEnabled: false, reminderState: '', dueAtMillis: Date.now(), createdAtMillis: Date.now() - 1000, updatedAtMillis: Date.now(), ...fields,
})
const aside = () => host.querySelector<HTMLElement>('[aria-label="安排详情"]')!
const trigger = () => aside().querySelector<HTMLButtonElement>('[aria-label="安排操作"]')!
const menuItem = (label: string) => document.querySelector<HTMLButtonElement>(`[role="menuitem"][aria-label="${label}"]`)!
const mutations = () => api.mock.calls.filter(([operation]) => operation === 'arrangements.mutate')
const click = async (button: HTMLElement) => { await act(async () => button.click()) }
const select = async (ref = 'one') => click(host.querySelector<HTMLElement>(`[data-arrangement-task="${ref}"] .arkme-arrangement-task-body`)!)
const mount = async () => { await act(async () => root.render(<ArkmeArrangementWorkspace accountScope={`detail-menu:${++scope}`} onAddArrangement={() => {}} />)) }

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  localStorage.clear()
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
  records = [makeItem()]
  api.mockReset().mockImplementation(async (operation, params) => {
    if (operation === 'arrangements.detail' || operation === 'arrangements.deleted.detail') return { ...records.find(item => item.arrangementRef === params.arrangementRef)! }
    if (operation === 'arrangements.mutate') {
      const record = records.find(item => item.arrangementRef === params.arrangementRef)!
      if (params.intent === 'delete') return { outcome: 'confirmed', deleted: true }
      record.status = params.intent === 'complete' ? 'completed' : 'following'
      record.updatedAtMillis = Date.now() + 1
      return { outcome: 'confirmed', item: { ...record } }
    }
    const rows = operation === 'arrangements.deleted.list' ? records : records.filter(item => item.status === params.status)
    return { items: rows, total: rows.length, hasMore: false }
  })
})
afterEach(async () => {
  await act(async () => root.unmount())
  host.remove(); vi.unstubAllGlobals()
  expect(document.querySelector('[role="menu"]')).toBeNull()
})

it('shows the full title once in the header and keeps commands hidden until requested', async () => {
  const title = '与客户确认覆盖多个门店的最终报价、实施范围以及合同付款节点'
  records = [makeItem('one', { title })]
  await mount(); await select()
  expect(aside().querySelector('header h2')?.textContent).toBe(title)
  expect(aside().querySelectorAll('h2')).toHaveLength(1)
  expect(trigger().getAttribute('aria-expanded')).toBe('false')
  expect(aside().querySelector('.arkme-arrangement-detail-actions')).toBeNull()
  expect(document.querySelector('[role="menu"]')).toBeNull()
  await click(trigger())
  expect(menuItem('完成安排')).not.toBeNull()
  expect(menuItem('删除')).not.toBeNull()
  expect(mutations()).toHaveLength(0)
})

it('closes with Escape or an outside click while keeping the detail pane available', async () => {
  await mount(); await select(); await click(trigger())
  await act(async () => menuItem('完成安排').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })))
  expect(document.querySelector('[role="menu"]')).toBeNull()
  expect(document.activeElement).toBe(trigger())
  await click(trigger())
  await act(async () => document.body.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true })))
  expect(document.querySelector('[role="menu"]')).toBeNull()
  expect(aside()).not.toBeNull()
  expect(mutations()).toHaveLength(0)
})

it('uses the existing confirmation before deleting and restores trigger focus after cancellation', async () => {
  await mount(); await select(); await click(trigger()); await click(menuItem('删除'))
  expect(document.querySelector('[role="menu"]')).toBeNull()
  const dialog = () => document.querySelector<HTMLElement>('[role="dialog"]')!
  expect(dialog()).not.toBeNull()
  expect(mutations()).toHaveLength(0)
  await click([...dialog().querySelectorAll('button')].find(button => button.textContent === '取消')!)
  expect(document.querySelector('[role="dialog"]')).toBeNull()
  expect(document.activeElement).toBe(trigger())
  await click(trigger()); await click(menuItem('删除'))
  await click([...dialog().querySelectorAll('button')].find(button => button.textContent === '删除')!)
  expect(mutations().map(([, params]) => params)).toEqual([{ arrangementRef: 'one', intent: 'delete' }])
  expect(document.querySelector('[role="dialog"]')).toBeNull()
  expect(host.textContent).toContain('已移入已删除')
})

it('offers restore for a completed item and keeps its existing mutation semantics', async () => {
  records = [makeItem('one', { status: 'completed' })]
  await mount()
  await click([...host.querySelectorAll('nav button')].find(button => button.textContent === '已完成')! as HTMLElement)
  await select(); await click(trigger())
  expect(menuItem('完成安排')).toBeNull()
  await click(menuItem('恢复为未完成'))
  expect(mutations().map(([, params]) => params)).toEqual([{ arrangementRef: 'one', intent: 'cancel-complete' }])
  expect(host.textContent).toContain('已恢复为未完成')
})

it('dismisses an old item menu when selecting another item and completes the correct item', async () => {
  records = [makeItem(), makeItem('two', { title: '确认现场施工窗口' })]
  await mount(); await select(); await click(trigger()); await select('two')
  expect(document.querySelector('[role="menu"]')).toBeNull()
  expect(aside().querySelector('header h2')?.textContent).toBe('确认现场施工窗口')
  await click(trigger()); await click(menuItem('完成安排'))
  expect(mutations().map(([, params]) => params)).toEqual([{ arrangementRef: 'two', intent: 'complete' }])
  expect(host.querySelector('[data-arrangement-task="one"]')).not.toBeNull()
  expect(host.querySelector('[data-arrangement-task="two"]')).toBeNull()
})

it('keeps deleted detail read-only without an action menu', async () => {
  records = [makeItem('one', { status: 'deleted' as ArkmeArrangementItem['status'] })]
  await mount()
  await click([...host.querySelectorAll('nav button')].find(button => button.textContent === '已删除')! as HTMLElement)
  await select()
  expect(aside().querySelector('header h2')?.textContent).toBe(records[0]!.title)
  expect(aside().querySelector('[aria-label="安排操作"]')).toBeNull()
  expect(mutations()).toHaveLength(0)
})
