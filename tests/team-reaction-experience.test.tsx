// @vitest-environment jsdom
// Exercise the enabled Team reaction integration, not a disabled menu fixture.
import {act} from 'react'
import {readFileSync} from 'node:fs'
import {resolve} from 'node:path'
import {createRoot, type Root} from 'react-dom/client'
import {afterEach,beforeEach,expect,it,vi} from 'vitest'
import {TeamConversationMessage} from '../src/client/TeamConversationMessage.js'
import type {TeamMessage} from '../src/team-app-contract.js'
import {ArkmeReactionSelections} from '../src/client/ArkmeReactionPreview.js'
import {reactionPreview} from '../src/client/reaction-preview-store.js'
import {emptyTeamReceipt,type TeamReceiptStore} from '../src/client/team-read-receipts.js'
vi.mock('../src/client/api.js',async original=>({...await original<object>(),callArkme:vi.fn(async()=>({revision:1,items:[]}))}))
const expression={text:'收到',color:'blue'}
const key='a'.repeat(64)
const message={ref:'message-ref',key:'message',seq:1,revision:1,side:'team' as const,sender:{nickname:'本人'},own:true,state:'published' as const,createdAt:1,canEdit:false,canDelete:false,version:1,contentStatus:'available' as const,media:[],content:{text_content:'测试正文',template_kind:1}}
let host:HTMLDivElement,root:Root,style:HTMLStyleElement
beforeEach(()=>{
 vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT',true)
 vi.stubGlobal('IntersectionObserver',class {observe(){} disconnect(){}})
 host=document.createElement('div');document.body.append(host);root=createRoot(host)
 style=document.createElement('style');style.textContent=readFileSync(resolve(import.meta.dirname,'../src/client/reaction-preview.css'),'utf8');document.head.append(style)
 reactionPreview.setScope('test:7')
 vi.spyOn(reactionPreview,'watch').mockReturnValue(()=>{})
 vi.spyOn(reactionPreview,'snapshot').mockReturnValue({target_id:'team:conversation:message',mine:{revision:1,selections:[{key,expression,at:1}]},groups:[{key,expression,count:1,actors:[{userId:7,displayName:'我'}]}],actors_visible:true,has_more:false,private:false})
})
afterEach(async()=>{await act(async()=>root.unmount());host.remove();style.remove();reactionPreview.setScope(undefined);vi.restoreAllMocks();vi.unstubAllGlobals()})
async function render(){await act(async()=>root.render(<TeamConversationMessage accountKey="test:7" conversationKey="conversation" conversationRef="conversation-ref" message={message} avatar={null} writable showReceipts={false} receiptStore={{subscribe:()=>()=>{},get:()=>emptyTeamReceipt,watch:()=>()=>{}} as unknown as TeamReceiptStore} busy={false} onEdit={()=>{}} onReceipts={()=>{}} onError={()=>{}}/>))}
it('uses only the inline entry when reactions exist, anchors its panel there and restores focus',async()=>{
 await render()
 const toolbar=host.querySelector<HTMLElement>('.arkme-reaction-hover-toolbar')!
 const entry=host.querySelector<HTMLButtonElement>('[data-arkme-reaction-toggle]')!
 expect(getComputedStyle(toolbar).display).toBe('none')
 vi.spyOn(entry,'getBoundingClientRect').mockReturnValue({left:240,right:268,top:360,bottom:388,width:28,height:28,x:240,y:360,toJSON(){}})
 await act(async()=>entry.click())
 const panel=document.querySelector<HTMLElement>('[aria-label="表态面板"]')!
 expect(panel.style.left).toBe('240px')
 await act(async()=>panel.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true})))
 expect(document.activeElement).toBe(entry)
 expect(document.querySelector('[aria-label="表态面板"]')).toBeNull()
 vi.spyOn(reactionPreview,'snapshot').mockReturnValue({target_id:'team:conversation:message',mine:{revision:2,selections:[]},groups:[],actors_visible:true,has_more:false,private:false})
 await render()
 expect(host.querySelector('[data-arkme-reaction-toggle]')).toBeNull()
 expect(getComputedStyle(toolbar).display).not.toBe('none')
 await act(async()=>host.querySelector<HTMLButtonElement>('.arkme-reaction-hover-trigger')!.click())
 expect(document.querySelector('[aria-label="表态面板"]')).not.toBeNull()
})
it.each([['team',false],['external',false],['team',true],['external',true]] as const)('keeps %s own=%s receipts visible and independently clickable while reactions are enabled',async(side,own)=>{
 const rect=(left:number,right:number,top:number,bottom:number)=>({left,right,top,bottom,width:right-left,height:bottom-top,x:left,y:top,toJSON(){}})
 vi.spyOn(HTMLElement.prototype,'getBoundingClientRect').mockImplementation(function(this:HTMLElement){
  if(this.hasAttribute('data-arkme-message-direction'))return rect(own?220:100,own?600:480,140,220)
  if(this.hasAttribute('data-arkme-read-receipt-indicator'))return rect(own?202:486,own?214:498,208,220)
  return rect(100,600,100,220)
 })
 const onReceipts=vi.fn(),onDetail=vi.fn()
 const receipt={value:{summary:{read:2,unread:1,total:3},visitorRead:true,members:[],hasMore:false,senderExcluded:true},loading:false,at:1}
 await act(async()=>root.render(<TeamConversationMessage accountKey="test:7" conversationKey="conversation" conversationRef="conversation-ref" message={{...message,side,own} as TeamMessage} avatar={null} writable showReceipts receiptStore={{subscribe:()=>()=>{},get:()=>receipt,watch:()=>()=>{}} as unknown as TeamReceiptStore} busy={false} onEdit={()=>{}} onReceipts={onReceipts} onDetail={onDetail} onError={()=>{}}/>))
 const toolbar=host.querySelector<HTMLElement>('.arkme-reaction-hover-toolbar')!
 const indicator=host.querySelector<HTMLElement>('[data-arkme-read-receipt-indicator]')!
 const parent=host.querySelector<HTMLElement>('[data-arkme-reaction-preview]')!.getBoundingClientRect()
 expect(Number.parseFloat(toolbar.style.top)+parent.top+26).toBeLessThanOrEqual(indicator.getBoundingClientRect().top-6)
 await act(async()=>host.querySelector<HTMLButtonElement>('[data-arkme-reaction-toggle]')!.click())
 expect(document.querySelector('[aria-label="表态面板"]')).not.toBeNull()
 const control=host.querySelector<HTMLButtonElement>('[data-arkme-read-receipt] button')!
 await act(async()=>control.click())
 expect(onReceipts).toHaveBeenCalledWith(control)
 expect(onDetail).not.toHaveBeenCalled()
 expect(indicator.textContent).toBe('2')
})
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
