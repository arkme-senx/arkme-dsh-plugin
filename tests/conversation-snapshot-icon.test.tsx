import {expect,it} from 'vitest'
import {conversationMessageMenu} from '../src/client/conversation-message-actions.js'
it('gives the shared Chat and Team detail action the existing info icon',()=>{
 const [detail]=conversationMessageMenu([{id:'detail',onSelect(){}}])
 expect(detail).toMatchObject({label:'详情'})
 expect(detail && 'icon' in detail && detail.icon).toBeTruthy()
})

it('keeps personal and Team property entry in the same action order and section',()=>{
 const ids=['withdraw','detail','copy','receipts','withdraw-divider'];
 const actions=conversationMessageMenu(ids.map(id=>id.endsWith('divider')?{id,type:'separator' as const}:{id,onSelect(){}}));
 expect(actions.map(action=>action.id)).toEqual(['copy','receipts','withdraw-divider','withdraw','detail']);
});
