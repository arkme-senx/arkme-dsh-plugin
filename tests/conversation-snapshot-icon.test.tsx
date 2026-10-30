import {expect,it} from 'vitest'
import {conversationMessageMenu} from '../src/client/conversation-message-actions.js'
it('gives the shared Chat and Team detail action the existing info icon',()=>{
 const [detail]=conversationMessageMenu([{id:'detail',onSelect(){}}])
 expect(detail).toMatchObject({label:'消息详情'})
 expect(detail && 'icon' in detail && detail.icon).toBeTruthy()
})
