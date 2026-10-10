import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { TeamDirectoryActions } from '../src/client/redesign/contacts/TeamDirectoryActions.js'
import { ArkmeActionMenu } from '../src/client/ArkmeDshMenu.js'

const call = vi.hoisted(() => vi.fn())
vi.mock('../src/client/api.js', () => ({callArkme: call}))
vi.mock('../src/client/redesign/contacts/ContactDirectoryAddDialog.js', () => ({
  DirectoryActionDialog: ({children}: {children: React.ReactNode}) => <div>{children}</div>,
}))
let root: ReactTestRenderer
const tick = async () => { await Promise.resolve(); await Promise.resolve() }
const change = async (index: number, value: string) => { await act(async () => {root.root.findAllByType('input')[index]!.props.onChange({target:{value}}); await tick()}) }
const submit = () => root.root.findByProps({type:'submit'})
const check = async () => {await act(async () => {await vi.advanceTimersByTimeAsync(600);await tick()})}
const text = () => JSON.stringify(root.toJSON())
beforeEach(async () => {
  vi.useFakeTimers(); call.mockReset()
  call.mockImplementation(async op => op === 'team.app.create.check' ? {available:true,reason:''} : {teamRef:'created'})
  await act(async () => {root = create(<TeamDirectoryActions accountKey="account" onChanged={() => {}} onSelect={() => {}} />)})
  await act(async () => {root.root.findByType(ArkmeActionMenu).props.actions.find((a:{id:string})=>a.id==='create').onSelect()})
  await change(0,'测试团队')
})
afterEach(async () => {await act(async () => root?.unmount());vi.useRealTimers()})

it('explains invalid input locally and only submits an available Team ID', async () => {
  await change(1,'你好'); await check()
  expect(text()).toContain('仅支持字母、数字和下划线')
  expect(submit().props.disabled).toBeTruthy(); expect(call).not.toHaveBeenCalled()
  await change(1,'abc'); await check()
  expect(text()).toContain('最少6位'); expect(call).not.toHaveBeenCalled()
  await change(1,'studio_1')
  expect(submit().props.disabled).toBeTruthy()
  await check()
  expect(submit().props.disabled).toBe(false)
  await act(async () => {root.root.findByType('form').props.onSubmit({preventDefault(){}}); await tick()})
  expect(call).toHaveBeenCalledWith('team.app.create', {name:'测试团队',jotmoId:'studio_1',requestUid:expect.any(String)},expect.any(AbortSignal))
})

it('discards an old availability result after typing a different ID', async () => {
  let resolve!: (v: unknown) => void
  call.mockImplementationOnce(() => new Promise(r => {resolve=r}))
  await change(1,'studio_1'); await check()
  const oldSignal = call.mock.calls[0]![2] as AbortSignal
  call.mockResolvedValue({available:false,reason:'taken'})
  await change(1,'studio_2'); await check()
  await act(async () => {resolve({available:true});await tick()})
  expect(oldSignal.aborted).toBe(true)
  expect(text()).toContain('该即我号已被占用')
  expect(submit().props.disabled).toBeTruthy()
})

it('offers a retry on validation failure, preserves the draft and submits no mutation', async () => {
  call.mockRejectedValueOnce(new Error('offline'))
  await change(1,'studio_1');await check()
  expect(text()).toContain('暂时无法校验即我号，请重试')
  expect(submit().props.disabled).toBeTruthy()
  await act(async () => {root.root.findAllByType('button').find(b=>b.children.join('')==='重试')!.props.onClick()})
  await check()
  expect(submit().props.disabled).toBe(false)
  expect(root.root.findAllByType('input')[1]!.props.value).toBe('studio_1')
  expect(call.mock.calls.every(c=>c[0]==='team.app.create.check')).toBe(true)
})
