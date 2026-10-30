import {expect,it} from 'vitest'
import {teamComposerDraft,teamMentions} from '../src/client/team-mentions.js'
import {insertArkmeComposerMentionToken,serializeArkmeComposerDraft,reconcileArkmeComposerMentions} from '../src/client/composer-draft-store.js'
import {loadTeamDraft,persistTeamDraft,restoreTeamDraftContent,updateTeamDraftText,teamDraftStartForInput} from '../src/client/team-message-draft.js'
it('retains exact identities through emoji encoding, persistence and edits; typing a name never creates a mention',()=>{
 const base=teamComposerDraft('[微笑] hi ')
 const inserted=insertArkmeComposerMentionToken(base,{mentionRef:'sealed-person'},'同名',base.text.length)!
 const encoded=serializeArkmeComposerDraft({...base,...inserted})
 const mentions=teamMentions(encoded.mentions)
 expect(encoded.text.slice(mentions[0]!.startIndex,mentions[0]!.startIndex+mentions[0]!.length)).toBe('@同名')
 const decoded=teamComposerDraft(encoded.text,mentions)
 expect(serializeArkmeComposerDraft(decoded)).toEqual(encoded)
 const values=new Map<string,string>();const storage={setItem:(k:string,v:string)=>values.set(k,v),getItem:(k:string)=>values.get(k)??null}
 persistTeamDraft(storage,'account:conversation',{text:encoded.text,mentions,assets:[]})
 const restored=loadTeamDraft(storage,'account:conversation')
 expect(restored.mentions).toEqual(mentions)
 expect(updateTeamDraftText(restored,'前缀'+encoded.text).mentions?.[0]?.startIndex).toBe(mentions[0]!.startIndex+2)
 expect(updateTeamDraftText(restored,encoded.text.replace('@同名','@新名')).mentions).toBeUndefined()
 expect(reconcileArkmeComposerMentions('','@同名',[])).toEqual([])
})
it('restores same-name drafts without merging different people or inventing mentions',()=>{
 const mention={personRef:'person-a',displayName:'同名',startIndex:0,length:3}
 const original={template_kind:1,text_content:'@同名',mentions:[mention]}
 expect(restoreTeamDraftContent(original,{text:'@同名',mentions:[mention]})).toEqual({text:'@同名',mentions:[mention]})
 expect(restoreTeamDraftContent(original,{text:'@同名',mentions:[{...mention,personRef:'person-b'}]})).toEqual({text:'@同名\n\n@同名',mentions:[mention,{...mention,personRef:'person-b',startIndex:5}]})
 expect(restoreTeamDraftContent(original,{text:'@同名'})).toEqual({text:'@同名\n\n@同名',mentions:[mention]})
 expect(restoreTeamDraftContent({template_kind:1,text_content:''},{text:'@同名',mentions:[mention]})).toEqual({text:'@同名',mentions:[mention]})
})

it('keeps undated restored input unknown and starts a new composer only after clearing',()=>{
 const legacy={text:'legacy',assets:[]}
 expect(updateTeamDraftText(legacy,'legacy continued',2000).startedAtMillis).toBeUndefined()
 const empty=updateTeamDraftText(legacy,'',2000)
 expect(updateTeamDraftText(empty,'new',3000).startedAtMillis).toBe(3000)
 expect(teamDraftStartForInput({text:'',assets:[]},4000)).toBe(4000)
 expect(teamDraftStartForInput(legacy,4000)).toBeUndefined()
 expect(updateTeamDraftText({text:'',assets:[],startedAtMillis:1000},'',5000).startedAtMillis).toBeUndefined()
})
