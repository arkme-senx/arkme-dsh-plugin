import {expect,it} from 'vitest'
import {conversationMessagesForSource,mergeConversationMessages} from '../src/client/conversation-message-merge.js'
import type {ArkmeTimelineItem} from '../src/types.js'
const item=(recordVersion:number,textContent:string,extra:Partial<ArkmeTimelineItem>={}):ArkmeTimelineItem=>({itemUid:'record',senderName:'sender',isMe:false,title:'',textContent,recordVersion,status:1,sendAtMillis:1,contentBlocks:[],...extra})
it('switches to approved body and drops every personal-only field when a group becomes source bound',()=>{
 const personal=item(2,'private',{contentBlocks:[{kind:'text',text:'private attachment'} as never],aiPolish:{state:'polished',polishedText:'private polish'} as never})
 const approved=item(1,'approved',{sourceSnapshot:true,messageActionRef:'approved-action'})
 const [result]=mergeConversationMessages([personal],[approved]);expect(result).toMatchObject(approved);expect(result?.contentBlocks).toEqual([]);expect(result?.aiPolish).toBeUndefined()
})
it('rejects a late personal response after the approved occurrence arrived',()=>{
 const approved=item(1,'approved',{sourceSnapshot:true})
 expect(mergeConversationMessages([approved],[item(9,'private')])).toEqual([approved])
 expect(mergeConversationMessages([approved],[item(2,'new approval',{sourceSnapshot:true})])[0]?.textContent).toBe('new approval')
})
it('preserves ordinary out-of-order version protection and allows an explicit inaccessible state',()=>{
 const newer=item(2,'ordinary')
 expect(mergeConversationMessages([newer],[item(1,'old')])).toEqual([newer])
 const source=item(1,'approved',{sourceSnapshot:true})
 expect(mergeConversationMessages([source],[item(0,'',{status:2})])[0]?.status).toBe(2)
})

it('hides an ordinary cached accepted body after source authority changes, while preserving other sources',()=>{
 const cached=[item(2,'private')],approved=item(1,'approved',{sourceSnapshot:true}),pending=item(1,'own pending',{isMe:true,status:0,sourceSnapshot:true})
 expect(conversationMessagesForSource(cached,false)).toBe(cached)
 expect(conversationMessagesForSource([...cached,item(9,'ordinary pending',{status:0}),item(9,'ordinary unavailable',{status:2}),approved,pending],true)).toEqual([approved,pending])
})
