import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ call: vi.fn() }))
vi.mock('../src/client/api.js', () => ({ callArkme: mocks.call }))
import { ArkmeArrangementCreate, ArkmeArrangementCreationStatus } from '../src/client/ArkmeArrangementCreate.js'

let view: ReactTestRenderer | undefined
const saved = vi.fn(), closed = vi.fn()
const dateContext = { defaultDate: '2026-10-20', timezone: 'Asia/Shanghai' }
const render = (overrides = {}) => <ArkmeArrangementCreate accountScope="prod:a" dateContext={dateContext} open onSaved={saved} onClose={closed} {...overrides} />
const type = (value: string) => act(() => view!.root.findByType('textarea').props.onChange({ target: { value } }))
const submit = () => view!.root.findByProps({ className: 'arkme-arrangement-create-finish' }).props.onClick()
beforeEach(async () => {
  const data = new Map<string, string>()
  vi.stubGlobal('sessionStorage', { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => data.set(key, value), removeItem: (key: string) => data.delete(key) })
  mocks.call.mockReset(); saved.mockReset(); closed.mockReset()
  await act(async () => { view = create(render()) })
})
afterEach(() => { act(() => view?.unmount()); vi.unstubAllGlobals() })

it('shares the composer and sends selected-date context separately from multiple original messages', async () => {
  expect(view!.root.findAllByType('input')).toHaveLength(0)
  expect(JSON.stringify(view!.toJSON())).toContain('默认日期：2026-10-20')
  type('准备项目会议')
  act(() => view!.root.findByProps({ 'aria-label': '发送' }).props.onClick())
  type('10月21日下午3点见面')
  const root = { arrangementRef: 'saved', title: '准备项目会议', recognitionState: 'recognizing' }
  mocks.call.mockResolvedValue({ items: [root] })
  await act(async () => submit())
  expect(mocks.call.mock.calls[0]?.slice(0, 2)).toEqual(['arrangements.create', expect.objectContaining({ texts: ['准备项目会议', '10月21日下午3点见面'], dateContext })])
  expect(mocks.call.mock.calls[0]?.[1]).not.toHaveProperty('dueAtMillis')
  expect(saved).toHaveBeenCalledWith([root]); expect(closed).toHaveBeenCalledOnce()
})

it('retains draft and request identity when date support is missing', async () => {
  type('安排草稿')
  mocks.call.mockRejectedValue({ body: { code: 'arrangement-date-context-unavailable' } })
  await act(async () => submit())
  expect(saved).not.toHaveBeenCalled(); expect(closed).not.toHaveBeenCalled()
  expect(view!.root.findByType('textarea').props.value).toBe('安排草稿')
  expect(JSON.stringify(view!.toJSON())).toContain('尚未提交安排')
  const first = mocks.call.mock.calls[0]?.[1].requestId
  await act(async () => submit())
  expect(mocks.call.mock.calls[1]?.[1].requestId).toBe(first)
})

it('isolates date, timezone, account and plain-composer drafts without relying on parent keys', async () => {
  type('20日草稿')
  await act(async () => view!.update(render({ dateContext: { ...dateContext, defaultDate: '2026-10-21' } })))
  expect(view!.root.findByType('textarea').props.value).toBe('')
  type('21日草稿')
  await act(async () => view!.update(render({ dateContext: undefined })))
  expect(view!.root.findByType('textarea').props.value).toBe('')
  expect(JSON.stringify(view!.toJSON())).not.toContain('默认日期')
  type('无日期草稿')
  await act(async () => view!.update(render({ accountScope: 'prod:b' })))
  expect(view!.root.findByType('textarea').props.value).toBe('')
  await act(async () => view!.update(render({ dateContext: { ...dateContext, timezone: 'UTC' } })))
  expect(view!.root.findByType('textarea').props.value).toBe('')
  await act(async () => view!.update(render()))
  expect(view!.root.findByType('textarea').props.value).toBe('20日草稿')
  await act(async () => view!.update(render({ dateContext: undefined })))
  expect(view!.root.findByType('textarea').props.value).toBe('无日期草稿')
})

it('plain creation does not insert today or a default time', async () => {
  await act(async () => view!.update(render({ dateContext: undefined })))
  type('找时间整理资料')
  mocks.call.mockResolvedValue({ items: [{ arrangementRef: 'plain' }] })
  await act(async () => submit())
  expect(mocks.call.mock.calls[0]?.[1]).toEqual({ requestId: expect.any(String), texts: ['找时间整理资料'] })
})

it('does not deliver a late creation result into another date/account', async () => {
  let resolve!: (value: unknown) => void
  mocks.call.mockImplementation(() => new Promise(done => { resolve = done }))
  type('旧账号草稿')
  await act(async () => submit())
  const signal = mocks.call.mock.calls[0]?.[2]
  await act(async () => view!.update(render({ accountScope: 'prod:b' })))
  await act(async () => resolve({ items: [{ arrangementRef: 'old-account' }] }))
  expect(signal.aborted).toBe(true)
  expect(saved).not.toHaveBeenCalled(); expect(closed).not.toHaveBeenCalled()
})

it('keeps undated saved roots visible as status while recognizing or after recognition failure', async () => {
  const state = { items: [{arrangementRef:'root',recognitionState:'recognizing'}] as never[], notice:'', merge:vi.fn(),retry:vi.fn() }
  await act(async () => view!.update(<ArkmeArrangementCreationStatus created={state} />))
  expect(JSON.stringify(view!.toJSON())).toContain('正在识别内容和日期')
  await act(async () => view!.update(<ArkmeArrangementCreationStatus created={{...state,items:[{recognitionState:'failed'} as never]}} />))
  expect(JSON.stringify(view!.toJSON())).toContain('可在安排模块查看原始内容')
  await act(async () => view!.update(<ArkmeArrangementCreationStatus created={{...state,items:[{recognitionState:'succeeded'} as never]}} />))
  expect(view!.toJSON()).toBeNull()
})
