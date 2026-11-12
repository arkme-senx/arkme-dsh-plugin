// @vitest-environment jsdom
import {act} from 'react'
import {createRoot} from 'react-dom/client'
import {expect,it,vi} from 'vitest'
import {useGroupTeamMentions} from '../src/client/use-group-team-mentions.js'
const {call}=vi.hoisted(()=>({call:vi.fn()}))
vi.mock('../src/client/api.js',()=>({callArkme:call}))

it.each(['team-group-backend-pending','team-not_accessible'])('distinguishes %s from an authorized empty Team roster',async code=>{
 vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true)
 call.mockRejectedValue(Object.assign(new Error(code),{body:{code}}))
 const container=document.createElement('div'),root=createRoot(container)
 let state:ReturnType<typeof useGroupTeamMentions>|undefined
 function Probe(){state=useGroupTeamMentions('test:7','source',true);return null}
 try{
  await act(async()=>root.render(<Probe/>))
  expect(state).toMatchObject({ready:false,items:[],unavailable:code==='team-group-backend-pending',error:code!=='team-group-backend-pending'})
 }finally{await act(async()=>root.unmount());vi.unstubAllGlobals();call.mockReset()}
})

it('keeps visible Team candidates during a same-account refresh and clears them on account change', async () => {
 vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true)
 const item={teamRef:'team'}
 const page={items:[item],hasMore:false,canManage:false,leaveAvailable:true}
 call.mockResolvedValueOnce(page).mockImplementation(()=>new Promise(()=>{}))
 const root=createRoot(document.createElement('div'))
 let state!:ReturnType<typeof useGroupTeamMentions>
 function Probe({account}:{account:string}){state=useGroupTeamMentions(account,'source',true);return null}
 try{
  await act(async()=>root.render(<Probe account="test:7"/>))
  expect(state).toMatchObject({items:[item],loading:false})
  await act(async()=>state.retry())
  expect(state).toMatchObject({items:[item],loading:true})
  await act(async()=>root.render(<Probe account="test:8"/>))
  expect(state).toMatchObject({items:[],loading:true})
 }finally{await act(async()=>root.unmount());vi.unstubAllGlobals();call.mockReset()}
})
