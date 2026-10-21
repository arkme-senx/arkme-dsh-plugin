// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { PeopleSurface } from '../src/client/explore/PeopleSurface.js'
import { PersonPicker } from '../src/client/explore/PersonPicker.js'
import { clearPeopleDirectoryCache } from '../src/client/explore/usePeopleDirectory.js'
import type { PersonFacet } from '../src/people-contract.js'
const mocks = vi.hoisted(() => ({ call: vi.fn() }))
vi.mock('../src/client/api.js', () => ({ callArkme: mocks.call }))
vi.mock('../src/client/ArkmeNoteDetails.js', () => ({ ArkmeTimelineDetailDrawer: () => null }))
const relation: PersonFacet = { key: 'e', personKey: 'u', source: 'relations', name: '宏顺', aliases: ['老何'], accountLinked: true, isSelf: false,
  relation: { key: 'e', ref: 'er', title: '宏顺', category: '人物', summary: '已保存概述', status: '', date: 1 } }
const speaker: PersonFacet = { key: 's', personKey: 'u', source: 'speakers', name: '何宏顺', aliases: [], accountLinked: true, isSelf: false, speakerRef: 'sr', assignmentRef: 'sr' }
const contact: PersonFacet = { key: 'c', personKey: 'u', source: 'contacts', name: '同事备注', hasRemark: true, aliases: [], accountLinked: true, isSelf: false, chatRef: 'cr', assignmentRef: 'ur' }
let root: Root, host: HTMLDivElement
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal('IntersectionObserver', class { observe() {} disconnect() {} })
  clearPeopleDirectoryCache(); mocks.call.mockReset()
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
})
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals() })
async function click(text: string) { const button = [...document.querySelectorAll('button')].find(x => x.textContent?.trim() === text); expect(button).toBeTruthy(); await act(async () => button!.click()) }
it('renders early sources, updates one person as contacts arrive, and keeps details visible while records load', async () => {
  let finishContacts!: (value: unknown) => void, finishRecords!: (value: unknown) => void
  mocks.call.mockImplementation(async (op, input) => {
    if (op === 'people.list') {
      if (input.source === 'contacts') return new Promise(resolve => { finishContacts = resolve })
      return { source: input.source, items: input.source === 'relations' ? [relation] : [speaker] }
    }
    if (op === 'explore.detail') return new Promise(resolve => { finishRecords = resolve })
  })
  await act(async () => root.render(<PeopleSurface accountScope="test:1" onBack={() => {}}/>))
  expect(host.querySelectorAll('.people-row')).toHaveLength(1)
  await act(async () => (host.querySelector('.people-row') as HTMLButtonElement).click())
  expect(host.textContent).toContain('已保存概述'); expect(host.textContent).toContain('正在读取相关记录')
  await act(async () => finishContacts({ source: 'contacts', items: [contact] }))
  expect(host.querySelector('h1')?.textContent).toBe('同事备注')
  expect(host.querySelectorAll('.people-row')).toHaveLength(1)
  const row = { key: 'record', text: '可定位的原文', speaker: '', date: 1, label: '来源', anchor: false }
  await act(async () => finishRecords({ evidence: [row, row] }))
  expect(host.querySelectorAll('.explore-evidence')).toHaveLength(1)
  expect(mocks.call.mock.calls.filter(x => x[0] === 'explore.detail')).toHaveLength(1)
})
it('reports partial failure without erasing available people', async () => {
  mocks.call.mockImplementation(async (_op, input) => { if (input.source === 'contacts') throw new Error('联系服务不可用'); return { source: input.source, items: input.source === 'speakers' ? [speaker] : [] } })
  await act(async () => root.render(<PeopleSurface accountScope="test:2" onBack={() => {}}/>))
  expect(host.querySelectorAll('.people-row')).toHaveLength(1)
  expect(host.textContent).toContain('即我联系人 · 暂不可用')
})
it('selects an existing speaker identity without writing and disables relation-only identity creation', async () => {
  const choose = vi.fn()
  const unbound = { ...relation, key: 'other', personKey: 'other', name: '张老师', accountLinked: false }
  mocks.call.mockImplementation(async (_op, input) => ({ source: input.source, items: input.source === 'relations' ? [relation, unbound] : input.source === 'contacts' ? [contact] : [speaker] }))
  await act(async () => root.render(<PersonPicker accountScope="test:3" onClose={() => {}} onChoose={choose}/>))
  const disabled = [...document.querySelectorAll<HTMLButtonElement>('.people-picker-list button')].find(x => x.textContent?.includes('张老师'))!
  expect(disabled.disabled).toBe(true)
  const linked = [...document.querySelectorAll<HTMLButtonElement>('.people-picker-list button')].find(x => x.textContent?.includes('同事备注'))!
  await act(async () => linked.click())
  expect(choose).toHaveBeenCalledWith({ label: '同事备注', speakerRef: 'sr' })
  expect(mocks.call.mock.calls.every(x => x[0] === 'people.list')).toBe(true)
})

it('keeps people visible while refreshing and after a refresh failure', async () => {
  mocks.call.mockImplementation(async (_op, input) => ({ source: input.source, items: input.source === 'speakers' ? [speaker] : [] }))
  await act(async () => root.render(<PeopleSurface accountScope="refresh" onBack={() => {}}/>))
  let fail!: (error: Error) => void
  mocks.call.mockImplementation(async (_op, input) => input.source === 'speakers' ? new Promise((_resolve, reject) => { fail = reject }) : { source: input.source, items: [] })
  await click('刷新')
  expect(host.querySelectorAll('.people-row')).toHaveLength(1)
  await act(async () => fail(new Error('暂时断网')))
  expect(host.querySelectorAll('.people-row')).toHaveLength(1)
  expect(host.textContent).toContain('录音说话人 · 暂不可用')
})

it('does not describe a failed speaker index as still processing', async () => {
  mocks.call.mockImplementation(async (op, input) => op === 'people.list' ? { source: input.source, items: input.source === 'speakers' ? [speaker] : [] } : { state: 'failed', dayCount: 0, items: [], lastSeenAt: 0 })
  await act(async () => root.render(<PeopleSurface accountScope="failed-index" onBack={() => {}}/>))
  await act(async () => (host.querySelector('.people-row') as HTMLButtonElement).click())
  await click('查看录音')
  expect(host.textContent).toContain('录音出现记录读取失败')
  expect(host.textContent).not.toContain('录音出现记录仍在整理')
})
