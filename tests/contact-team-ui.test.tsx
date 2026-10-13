import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, expect, it, vi } from 'vitest'
const api = vi.hoisted(() => ({ call: vi.fn() }))
vi.mock('../src/client/api.js', () => ({callArkme: api.call, ArkmeClientError: class extends Error {}}))
import { ArkmeContactAddSurface } from '../src/client/ArkmeContactAddSurface.js'
let renderer: ReactTestRenderer
function text(): string { return JSON.stringify(renderer.toJSON()) }
afterEach(() => { if (renderer) act(() => renderer.unmount()); api.call.mockReset() })
it('renders a team and retains accepted admission without a second search', async () => {
 const registered = false
 let pending = false
 api.call.mockImplementation(async (op: string) => {
  if (op === 'user.profile') return {profile: {displayName:'本人'}}
  if (op === 'contacts.search') return {contactRef:'contact', identifierKind:'arkme_id', displayName:'个人同名', registered, canAdd:registered, isSelf:false,
    team: {name:'即我团队', jotmoId:'arkme_cn', state:pending?'pending':'none', requiresApproval:true, avatar:{mode:'default',key:'team'}}}
  if (op === 'contacts.team-join') {pending=true;return {state:'pending'}}
  throw new Error(op)
 })
 await act(async () => {renderer=create(<ArkmeContactAddSurface compact shareWebsite="https://jiwo.cc" onSourceActivated={vi.fn()}/> )})
 await act(async () => {renderer.root.findAllByType('input')[0]!.props.onChange({target:{value:'arkme_cn'}})})
 await act(async () => {renderer.root.findByType('form').props.onSubmit({preventDefault(){}})})
 expect(text()).toContain('即我团队');expect(text()).toContain('申请加入团队')
 expect(text().includes('个人同名')).toBe(registered)
 expect(text()).not.toContain('该账号当前无法添加')
 const button=()=>renderer.root.findAllByType('button').find(v=>typeof v.props.children === 'string' && v.props.children.includes('申请'))!
 await act(async()=>{button().props.onClick()})
 expect(text()).toContain('申请已提交，等待审批');expect(button().props.disabled).toBe(true)
 const joins=api.call.mock.calls.filter(c=>c[0]==='contacts.team-join');expect(joins).toHaveLength(1)
 expect(joins[0]?.[1]).toMatchObject({jotmoId:'arkme_cn',requestUid:expect.stringMatching(/^[0-9a-f-]{36}$/)})
 expect(api.call.mock.calls.some(c=>c[0]==='contacts.add')).toBe(false)
 expect(api.call.mock.calls.filter(c=>c[0]==='contacts.search')).toHaveLength(1)
})

it.each([
 ['none', false, 'Join team', false],
 ['none', true, 'Apply to join team', false],
 ['pending', true, 'Request submitted, awaiting approval', true],
 ['joined', true, 'Joined the team', true],
 ['rejected', true, 'Apply to join again', false],
] as const)('uses existing team translations for %s / approval=%s', async (state, requiresApproval, label, disabled) => {
 const { connectArkmeLocale } = await import('../src/client/locale.js')
 const disconnect = connectArkmeLocale({getLocale:()=>({active:'en'}),subscribe:()=>()=>{}})
 try {
  api.call.mockImplementation(async (op:string) => op === 'user.profile' ? {profile:null} : {
   registered:false, canAdd:false, identifierKind:'arkme_id',
   team:{name:'International team',jotmoId:'arkme_cn',state,requiresApproval,avatar:{mode:'default',key:'team'}},
  })
  await act(async()=>{renderer=create(<ArkmeContactAddSurface compact shareWebsite="https://jiwo.cc" onSourceActivated={vi.fn()}/>)})
  await act(async()=>{renderer.root.findAllByType('input')[0]!.props.onChange({target:{value:'arkme_cn'}})})
  await act(async()=>{renderer.root.findByType('form').props.onSubmit({preventDefault(){}})})
  const card = renderer.root.findAllByType('section').find(v=>v.props['aria-label']==='Team search result')!
  const button = card.findByType('button')
  expect(button.props.children).toBe(label)
  expect(button.props.disabled).toBe(disabled)
  expect(card.findAllByType('p')[1]!.props.children[0]).toBe('Team')
 } finally {
  disconnect(); connectArkmeLocale({getLocale:()=>({active:'zh'}),subscribe:()=>()=>{}})()
 }
})
