// @vitest-environment jsdom
// Exercise the enabled Team reaction integration, not a disabled menu fixture.
import {act} from 'react'
import {createRoot, type Root} from 'react-dom/client'
import {afterEach,beforeEach,expect,it,vi} from 'vitest'
import {TeamConversationMessage} from '../src/client/TeamConversationMessage.js'
import {ArkmeReactionSelections} from '../src/client/ArkmeReactionPreview.js'
import {reactionPreview} from '../src/client/reaction-preview-store.js'
import {emptyTeamReceipt,type TeamReceiptStore} from '../src/client/team-read-receipts.js'
vi.mock('../src/client/api.js',async original=>({...await original<object>(),callArkme:vi.fn(async()=>({revision:1,items:[]}))}))
const expression={text:'收到',color:'blue'}
const key='a'.repeat(64)
const message={ref:'message-ref',key:'message',seq:1,revision:1,side:'team' as const,sender:{nickname:'本人'},own:true,state:'published' as const,createdAt:1,canEdit:false,canDelete:false,version:1,contentStatus:'available' as const,media:[],content:{text_content:'测试正文',template_kind:1}}
let host:HTMLDivElement,root:Root
beforeEach(()=>{
 vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true)
 host=document.createElement('div');document.body.append(host);root=createRoot(host)
 reactionPreview.setScope('test:7')
 vi.spyOn(reactionPreview,'watch').mockReturnValue(()=>{})
 vi.spyOn(reactionPreview,'snapshot').mockReturnValue({target_id:'team:conversation:message',mine:{revision:1,selections:[{key,expression,at:1}]},groups:[{key,expression,count:1,actors:[{userId:7,displayName:'我'}]}],actors_visible:true,has_more:false,private:false})
})
afterEach(async()=>{await act(async()=>root.unmount());host.remove();reactionPreview.setScope(undefined);vi.restoreAllMocks();vi.unstubAllGlobals()})
async function render(){await act(async()=>root.render(<TeamConversationMessage accountKey="test:7" conversationKey="conversation" conversationRef="conversation-ref" message={message} avatar={null} writable showReceipts={false} receiptStore={{subscribe:()=>()=>{},get:()=>emptyTeamReceipt,watch:()=>()=>{}} as unknown as TeamReceiptStore} busy={false} onEdit={()=>{}} onReceipts={()=>{}} onError={()=>{}}/>))}
it('keeps Team selections inside the bubble and reaction hover region',async()=>{
 await render()
 const selections=host.querySelector('[data-arkme-message-reactions]')!
 expect(selections).not.toBeNull()
 expect(selections.closest('.arkme-timed-bubble')).not.toBeNull()
 expect(selections.nextElementSibling?.classList.contains('arkme-message-timestamp')).toBe(true)
 expect(selections.closest('[data-arkme-reaction-preview]')).not.toBeNull()
})
it('exposes the actual bubble geometry to the shared hover entry',async()=>{
 await render()
 expect(host.querySelector('.arkme-timed-bubble')).not.toBeNull()
 expect(host.querySelector('[data-arkme-reaction-preview] [data-arkme-message-direction]')).toBe(host.querySelector('.arkme-timed-bubble'))
})
it('toggles inline add open, closed and open without opening message details',async()=>{
 await render()
 const click=async()=>act(async()=>{host.querySelector<HTMLButtonElement>('[aria-label="继续表态"]')!.click()})
 await click();expect(document.querySelectorAll('[aria-label="表态面板"]')).toHaveLength(1)
 await click();expect(document.querySelectorAll('[aria-label="表态面板"]')).toHaveLength(0)
 await click();expect(document.querySelectorAll('[aria-label="表态面板"]')).toHaveLength(1)
})
it('uses the known self name while reaction actors are being hydrated',async()=>{
 await render()
 expect(host.querySelector('[aria-label="查看我的资料"]')).toBeNull()
 expect(host.querySelector('[aria-label="查看本人的资料"]')).not.toBeNull()
})
it('uses known Team identities in paginated actors when optional Host profiles are unavailable',async()=>{
 vi.spyOn(reactionPreview,'snapshot').mockReturnValue({target_id:'team:conversation:message',mine:{revision:1,selections:[]},groups:[{key,expression,count:2,actors:[]}],actors_visible:true,has_more:false,private:false})
 vi.spyOn(reactionPreview,'actors').mockResolvedValue({items:[{userId:7,displayName:'用户'},{userId:8,displayName:'用户',teamPersonKey:'peer'}],has_more:false})
 await act(async()=>root.render(<ArkmeReactionSelections scope="test:7" target={{id:'team:conversation:message',source:'team',sourceKey:'team',itemUid:'message',text:'',resolveActor:actor=>({...actor,displayName:actor.userId===7?'本人昵称':'私人备注'})}}/>))
 await act(async()=>host.querySelector<HTMLButtonElement>('[aria-label="查看 2 位表态者"]')!.click())
 const actors=host.querySelector('[aria-label="表态者"]')!
 expect(actors.textContent).toContain('本人昵称')
 expect(actors.textContent).toContain('私人备注')
 expect(actors.textContent).not.toContain('用户')
})
