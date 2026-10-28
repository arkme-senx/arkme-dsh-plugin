import type { ReactNode } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
const mocks=vi.hoisted(()=>({call:vi.fn()}))
vi.mock('../src/client/api.js',()=>({callArkme:mocks.call}))
vi.mock('../src/client/redesign/contacts/TeamCodexActivity.js',()=>({TeamCodexActivity:(props:{headerActions?:ReactNode})=><div data-reader {...props}>{props.headerActions}</div>}))
import { CodexConversationSurface } from '../src/client/redesign/contacts/CodexConversationSurface.js'
import { arkmeUi } from '../src/client/ui-controller.js'
import { arkmeContactsTab } from '../src/client/redesign/contacts/contacts-tab-store.js'
const team={teamRef:'team-a',name:'Team A',jotmoId:'a',currentUserRole:'member',createdAtMillis:1,updatedAtMillis:1}
let renderer:ReactTestRenderer|undefined
const tick=async()=>{await Promise.resolve();await Promise.resolve();await Promise.resolve()}
const readers=()=>renderer!.root.findAllByProps({'data-reader':true})
const own=()=>readers().find(reader=>reader.props.personalTeams)!
beforeEach(()=>{arkmeUi.authChanged(false);mocks.call.mockReset();mocks.call.mockResolvedValue({items:[team],hasMore:false,totalCount:1})})
afterEach(async()=>{await act(async()=>{renderer?.unmount();await tick()});arkmeContactsTab.activateAccount(undefined)})
it('opens own tasks automatically without a team gate or changes to upload settings',async()=>{
  arkmeUi.showCodex(null)
  await act(async()=>{renderer=create(<CodexConversationSurface accountKey="prod:11" userId={11} active/>);await tick()})
  expect(own().props).toMatchObject({teamRef:'',personalTeams:[team],selfMember:'11',active:true,conversation:true})
  expect(renderer!.root.findAllByType('select')).toHaveLength(0)
  expect(mocks.call.mock.calls.every(call=>call[0]==='team.list')).toBe(true)
  await act(async()=>{own().props.onManage();await tick()})
  expect(renderer!.root.findByProps({role:'dialog'}).props['aria-label']).toBe('团队工作台')
  await act(async()=>{renderer!.root.findByProps({className:'arkme-codex-team-choice'}).props.onClick();await tick()})
  expect(arkmeUi.getSnapshot()).toMatchObject({mode:'source',productMode:'contacts'})
  expect(arkmeContactsTab.getSnapshot()).toMatchObject({accountKey:'prod:11',selection:{kind:'team',teamRef:'team-a',view:'members'}})
})
it('keeps own reader mounted while inspecting a team task, then returns to it',async()=>{
  const target={accountKey:'prod:11',team,fromTeam:true,page:3,member:'22',task:{id:'remote-task'}}
  arkmeUi.showCodex(null)
  await act(async()=>{renderer=create(<CodexConversationSurface accountKey="prod:11" userId={11} active/>);await tick()})
  const personalReader=own()
  await act(async()=>{arkmeUi.showCodex(target as never);await tick()})
  expect(own()).toBe(personalReader);expect(own().props.active).toBe(false)
  expect(readers().find(r=>!r.props.personalTeams)?.props.target).toBe(target)
  await act(async()=>{renderer!.root.findAllByType('button').find(b=>b.children.includes('回到我的任务'))!.props.onClick();await tick()})
  expect(own()).toBe(personalReader);expect(own().props.active).toBe(true)
  expect(arkmeUi.getSnapshot().codexTarget).toBeUndefined()
})
it('keeps separate readers for members in the same team and returns to the member directory',async()=>{
  const first={accountKey:'prod:11',team,fromTeam:true,member:'member-a',memberName:'A',returnView:'members' as const}
  arkmeUi.showCodex(first)
  await act(async()=>{renderer=create(<CodexConversationSurface accountKey="prod:11" userId={11} active/>);await tick()})
  const a=readers().find(r=>r.props.target?.member==='member-a')!
  await act(async()=>{arkmeUi.showCodex({...first,member:'member-b',memberName:'B'});await tick()})
  expect(a.props.active).toBe(false)
  expect(readers().find(r=>r.props.target?.member==='member-b')?.props.active).toBe(true)
  await act(async()=>{arkmeUi.showCodex(first);await tick()})
  expect(readers().find(r=>r.props.target?.member==='member-a')).toBe(a)
  expect(a.props.active).toBe(true)
  await act(async()=>{a.findAllByType('button').find(b=>b.children.includes('返回团队'))!.props.onClick();await tick()})
  expect(arkmeContactsTab.getSnapshot().selection).toMatchObject({kind:'team',teamRef:'team-a',view:'members'})
})
it('ignores another account target and defaults to the current account own reader',async()=>{
  arkmeUi.showCodex({accountKey:'prod:22',team})
  await act(async()=>{renderer=create(<CodexConversationSurface accountKey="prod:11" userId={11} active/>);await tick()})
  expect(readers()).toHaveLength(1)
  expect(own().props).toMatchObject({selfMember:'11',active:true})
})
it('collects all team directory pages using the opaque cursor',async()=>{
  mocks.call.mockResolvedValueOnce({items:[team],hasMore:true,totalCount:2,nextPageCursor:'opaque-cursor'})
    .mockResolvedValueOnce({items:[{...team,teamRef:'team-b',name:'Team B'}],hasMore:false,totalCount:2})
  await act(async()=>{renderer=create(<CodexConversationSurface accountKey="prod:11" userId={11} active/>);await tick()})
  expect(mocks.call).toHaveBeenLastCalledWith('team.list',{limit:50,pageCursor:'opaque-cursor'},expect.anything())
  expect(own().props.personalTeams.map((t:{teamRef:string})=>t.teamRef)).toEqual(['team-a','team-b'])
})
it('removes revoked team panels on re-entry, without clearing other navigation state',async()=>{
  arkmeUi.showCodex({accountKey:'prod:11',team,fromTeam:true})
  await act(async()=>{renderer=create(<CodexConversationSurface accountKey="prod:11" userId={11} active/>);await tick()})
  await act(async()=>{renderer!.update(<CodexConversationSurface accountKey="prod:11" userId={11} active={false}/>);await tick()})
  mocks.call.mockResolvedValue({items:[],hasMore:false})
  await act(async()=>{renderer!.update(<CodexConversationSurface accountKey="prod:11" userId={11} active/>);await tick()})
  expect(readers()).toHaveLength(1)
  expect(own().props.personalTeams).toEqual([])
  expect(arkmeUi.getSnapshot().codexTarget).toBeUndefined()
})
it('stops on repeated directory cursors rather than polling forever',async()=>{
  mocks.call.mockResolvedValue({items:[team],hasMore:true,nextPageCursor:'repeat'})
  await act(async()=>{renderer=create(<CodexConversationSurface accountKey="prod:11" userId={11} active/>);await tick()})
  expect(mocks.call).toHaveBeenCalledTimes(2)
  expect(own().props.active).toBe(false)
  expect(renderer!.root.findByProps({role:'alert'}).children).toContain('团队列表未完整加载，请重试')
})
