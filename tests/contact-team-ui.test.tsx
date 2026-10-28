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
 expect(text()).toContain('申请已提交，等待审批')
 const card = renderer.root.findAllByType('section').find(v=>v.props['aria-label']==='团队搜索结果')!
 expect(card.findAllByType('button')).toHaveLength(0)
 expect(card.findAll(v=>v.props.role==='status' && v.props.children==='申请已提交，等待审批')).toHaveLength(1)
 expect(renderer.root.findAll(v=>v.props['data-arkme-contact-status-feedback']!==undefined)).toHaveLength(0)
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
 ['rejected', true, 'Apply to join team', false],
 ['rejected', false, 'Join team', false],
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
  if (disabled) {
   expect(card.findAllByType('button')).toHaveLength(0)
   expect(card.findByProps({role:'status'}).props.children).toBe(label)
  } else {
   expect(card.findByType('button').props.children).toBe(label)
   expect(card.findByType('button').props.disabled).toBe(false)
  }
  expect(renderer.root.findAll(v=>v.props['data-arkme-contact-status-feedback']!==undefined)).toHaveLength(0)
  expect(card.findAllByType('p')[1]!.props.children[0]).toBe('Team')
 } finally {
  disconnect(); connectArkmeLocale({getLocale:()=>({active:'zh'}),subscribe:()=>()=>{}})()
 }
})


it('reuses the original contact card geometry and in-card notice treatment', async () => {
 let team = false
 api.call.mockImplementation(async (op:string) => op === 'user.profile' ? {profile:null} : team
  ? {registered:false,canAdd:false,identifierKind:'arkme_id',team:{name:'Team',jotmoId:'arkme_cn',state:'pending',requiresApproval:true,avatar:{mode:'default',key:'team'}}}
  : {registered:false,canAdd:false,isSelf:false,identifierKind:'arkme_id',displayName:'Nobody'})
 await act(async()=>{renderer=create(<ArkmeContactAddSurface compact shareWebsite="https://jiwo.cc" onSourceActivated={vi.fn()}/>)})
 const search=async()=>{await act(async()=>{renderer.root.findAllByType('input')[0]!.props.onChange({target:{value:'arkme_cn'}})});await act(async()=>{renderer.root.findByType('form').props.onSubmit({preventDefault(){}})})}
 await search()
 const personal=renderer.root.findByType('section')
 const cardStyle=personal.props.style
 const identityStyle=personal.findAllByType('div')[0]!.props.style
 const noticeStyle=personal.findAllByType('div').find(v=>v.props.children==='该账号当前无法添加')!.props.style
 team=true;await search()
 const result=renderer.root.findByType('section')
 expect(result.props.style).toEqual(cardStyle)
 expect(result.findAllByType('div')[0]!.props.style).toEqual(identityStyle)
 expect(result.findByProps({role:'status'}).props.style).toEqual(noticeStyle)
})
