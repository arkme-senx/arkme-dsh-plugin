import {act,create,type ReactTestRenderer} from 'react-test-renderer'
import {afterEach,it,expect,vi} from 'vitest'
const mock=vi.hoisted(()=>({call:vi.fn()}))
vi.mock('../src/client/api.js',()=>({callArkme:mock.call}))
import {TeamGovernanceDialog} from '../src/client/redesign/contacts/TeamGovernanceDialog.js'
let renderer:ReactTestRenderer|undefined
afterEach(()=>{act(()=>renderer?.unmount());renderer=undefined;mock.call.mockReset()})
const intent={kind:'transfer' as const,teamRef:'team-ref',userRef:'member-ref',name:'同事',revision:4}
it('uses the established dialog and requires explicit confirmation before transfer',async()=>{
 const complete=vi.fn();mock.call.mockResolvedValue({active:true,dissolving:false,membershipRevision:5})
 await act(async()=>{renderer=create(<TeamGovernanceDialog accountKey="test:1" teamName="团队" intent={intent} onClose={()=>{}} onComplete={complete}/>)} )
 expect(renderer!.root.findByProps({role:'dialog'}).props.className).toContain('arkme-team-sync-dialog')
 expect(mock.call).not.toHaveBeenCalled()
 const confirm=renderer!.root.findAllByType('button').find(b=>b.children.join('')==='确认')!
 await act(async()=>{await confirm.props.onClick()})
 expect(mock.call).toHaveBeenCalledWith('team.app.governance.transfer',{expectedAccountKey:'test:1',teamRef:'team-ref',userRef:'member-ref',expectedMembershipRevision:4},expect.any(AbortSignal))
 expect(complete).toHaveBeenCalledWith({active:true,dissolving:false,membershipRevision:5})
})
it('ignores a late result after the account-scoped dialog unmounts',async()=>{
 let resolve!:(v:unknown)=>void
 mock.call.mockReturnValue(new Promise(r=>{resolve=r}))
 const complete=vi.fn()
 await act(async()=>{renderer=create(<TeamGovernanceDialog accountKey="test:1" teamName="团队" intent={intent} onClose={()=>{}} onComplete={complete}/>)} )
 await act(async()=>{renderer!.root.findAllByType('button').find(b=>b.children.join('')==='确认')!.props.onClick()})
 const signal=mock.call.mock.calls[0]![2] as AbortSignal
 act(()=>renderer!.unmount());renderer=undefined
 expect(signal.aborted).toBe(true)
 await act(async()=>resolve({active:true,dissolving:false,membershipRevision:5}))
 expect(complete).not.toHaveBeenCalled()
})
