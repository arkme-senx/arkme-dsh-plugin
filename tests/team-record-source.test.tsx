import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ call: vi.fn(), open: vi.fn() }))
vi.mock('../src/client/api.js', () => ({ callArkme: mocks.call }))
vi.mock('../src/client/team-messaging-events.js', () => ({ openTeamMessages: mocks.open }))
vi.mock('@deepseek-ai/dsh-client-ui-primitives', async original => ({ ...await original<typeof import('@deepseek-ai/dsh-client-ui-primitives')>(), Toast: ({text}: {text:string}) => <span role="alert">{text}</span> }))
import { TeamRecordSource, TeamRecordSourceScope } from '../src/client/TeamRecordSource.js'
import { arkmeAuthStore } from '../src/client/auth-store.js'
let view: ReactTestRenderer | undefined
const source = { name: '设计工作室', conversationRef: 'sealed-ref' }
beforeEach(() => { mocks.call.mockReset(); mocks.open.mockReset() })
afterEach(async () => { await act(async () => view?.unmount()); view = undefined })
const mount = async () => { await act(async () => { view = create(<TeamRecordSourceScope>
  <p>个人快记正文</p><TeamRecordSource conversationUid="conversation" /><TeamRecordSource conversationUid="conversation" navigable />
</TeamRecordSourceScope>) }) }
it('deduplicates labels and enters the actual Team thread only after a fresh authority check', async () => {
  const conversation = {ref:'sealed-current', side:'team',channel:{name:'设计工作室'}}
  mocks.call.mockImplementation(async op => op === 'team.app.source' ? source : {conversation})
  await mount()
  expect(mocks.call).toHaveBeenCalledTimes(1)
  expect(JSON.stringify(view!.toJSON())).toContain('设计工作室')
  await act(async () => view!.root.findByType('button').props.onClick({stopPropagation(){}}))
  expect(mocks.call.mock.calls.map(c=>c[0])).toEqual(['team.app.source','team.app.source','team.app.timeline'])
  expect(mocks.open).toHaveBeenCalledWith({kind:'conversation',conversation})
})
it('keeps personal content readable on Team failure and offers another attempt', async () => {
  mocks.call.mockRejectedValue(new Error('not_accessible'))
  await mount()
  expect(JSON.stringify(view!.toJSON())).toContain('个人快记正文')
  await act(async () => view!.root.findByType('button').props.onClick({stopPropagation(){}}))
  expect(mocks.open).not.toHaveBeenCalled()
  expect(JSON.stringify(view!.toJSON())).toContain('暂时无法打开团队对话')
  expect(view!.root.findByType('button').props.disabled).toBe(false)
})
it('cannot navigate with the previous account response after the account changes', async () => {
  mocks.call.mockResolvedValue(source)
  await mount()
  let finish!: (value: unknown) => void
  mocks.call.mockImplementation(() => new Promise(resolve => { finish=resolve }))
  await act(async () => { view!.root.findByType('button').props.onClick({stopPropagation(){}}) })
  const oldSignal=mocks.call.mock.calls.at(-1)![2] as AbortSignal
  const finishOld = finish
  await act(async () => arkmeAuthStore.setAuth({status:'authenticated',userId:42,environment:'test'}))
  expect(oldSignal.aborted).toBe(true)
  await act(async () => finishOld(source))
  expect(mocks.open).not.toHaveBeenCalled()
})
