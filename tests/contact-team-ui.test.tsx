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
