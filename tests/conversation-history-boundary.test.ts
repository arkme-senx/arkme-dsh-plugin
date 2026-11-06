import {expect,it} from 'vitest'
import {conversationMessageVisibleFromSequence,mergeConversationMessages} from '../src/client/conversation-message-merge.js'
import type {ArkmeTimelineItem} from '../src/types.js'
const item=(recordVersion:number,textContent:string,extra:Partial<ArkmeTimelineItem>={}):ArkmeTimelineItem=>({itemUid:'record',senderName:'sender',isMe:false,title:'',textContent,recordVersion,status:1,sendAtMillis:1,contentBlocks:[],...extra})
it('keeps the ordinary current version when an older response arrives after association',()=>{
 const current=item(2,'current')
 expect(mergeConversationMessages([current],[item(1,'old')])).toEqual([current])
 expect(mergeConversationMessages([current],[item(3,'edited')])[0]?.textContent).toBe('edited')
})
it('applies admission sequence boundaries independently of content versions',()=>{
 const visible=item(1,'visible',{sequence:6})
 expect(conversationMessageVisibleFromSequence(item(99,'old',{sequence:4}),5)).toBe(false)
 expect(conversationMessageVisibleFromSequence(item(99,'unknown sequence'),5)).toBe(false)
 expect(conversationMessageVisibleFromSequence(visible,5)).toBe(true)
 expect(conversationMessageVisibleFromSequence(visible,0)).toBe(true)
 expect(conversationMessageVisibleFromSequence(item(2,'existing imported history',{sequence:-1}),0)).toBe(true)
 expect(conversationMessageVisibleFromSequence(item(3,'pending',{isMe:true,status:0}),5)).toBe(true)
 expect(conversationMessageVisibleFromSequence(item(3,'ordinary'))).toBe(true)
})
