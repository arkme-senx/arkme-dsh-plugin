import { expect, it } from 'vitest'
import { mergeTeamMessages, teamMessageProjection } from '../src/team-message-projection.js'
import { ConfirmedSendRetentionOwner } from '../src/client/confirmed-send-retention.js'
import type { TeamMessage } from '../src/team-app-contract.js'

const original: TeamMessage = { key:'m',ref:'ref',seq:1,revision:1,side:'team',sender:{nickname:'我'},own:true,state:'published',createdAt:1,canEdit:true,canDelete:true,canRecall:true,version:1,contentStatus:'available',content:{text_content:'must disappear',template_kind:1},media:[] }
const recalled=teamMessageProjection({...original,state:'recalled',revision:2})
it('terminal projection removes all retained body and wins any late ACK',()=>{
 expect(recalled.content).toBeUndefined()
 expect(recalled).toMatchObject({canRecall:false,canEdit:false,canDelete:false,contentStatus:'recalled',media:[]})
 expect(mergeTeamMessages([recalled],[original])).toEqual([recalled])
 expect(mergeTeamMessages([original],[recalled])).toEqual([recalled])
})
it('the existing bounded retention owner preserves terminal knowledge across windows and late retain',()=>{
 const owner=new ConfirmedSendRetentionOwner<TeamMessage>({maxItems:8,ttlMillis:1000,key:m=>m.key,canRetain:m=>m.own,isAuthoritative:m=>m.state==='recalled'||m.version>0,isTerminal:m=>m.state==='recalled',merge:mergeTeamMessages})
 owner.retain('c',original,0)
 expect(owner.merge('c',[recalled],1)).toEqual([recalled])
 expect(owner.merge('c',[],2)).toEqual([])
 owner.retain('c',original,3)
 expect(owner.merge('c',[original],4)).toEqual([recalled])
 expect(owner.merge('other',[original],4)).toEqual([original])
})
