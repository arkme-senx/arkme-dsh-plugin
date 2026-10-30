// @vitest-environment jsdom
import {afterEach,expect,it,vi} from 'vitest'
import {teamChangeAffectsSource,watchTeamSourceRead,invalidateTeamMessageRead,TeamSendReadFence} from '../src/client/team-source-read.js'
import type {TeamMessage} from '../src/team-app-contract.js'
import {invalidateTeamMessages} from '../src/client/team-messaging-events.js'
const call=vi.hoisted(()=>vi.fn())
vi.mock('../src/client/api.js',()=>({callArkme:call}))
const target={accountKey:'test:42',conversationRef:'conversation',conversationKey:'conversation-key',messageRef:'message',messageKey:'message-key',version:3}
let stop:(()=>void)|undefined
const sent:TeamMessage={key:'sent',ref:'sent-ref',seq:1,revision:2,side:'team',sender:{nickname:'我'},own:true,state:'published',createdAt:1,canEdit:true,canDelete:true,version:3,contentStatus:'available',content:{text_content:'accepted body'},media:[]}
it('fences early source changes without blanking same versions or unrelated bodies',()=>{
 for(const revision of [1,2,3,0]){
  const fence=new TeamSendReadFence('conversation-key');fence.begin('send')
  fence.invalidate({kind:'team.message.changed',messageKey:sent.key,messageRevision:revision})
  const projected=fence.projectAcknowledgement(sent,'send')
  if(revision===1||revision===2)expect(projected).toBe(sent)
  else expect(projected.content).toBeUndefined()
 }
 const fence=new TeamSendReadFence('conversation-key');fence.begin('send')
 fence.invalidate({kind:'team.message.changed',messageKey:sent.key,messageRevision:3,conversationKeys:['other']})
 fence.invalidate({kind:'team.message.changed',messageKey:'other',messageRevision:3})
 expect(fence.projectAcknowledgement(sent,'send')).toBe(sent)
})
it('keeps unknown reconciliation fences on pending ACKs, allowing later sends and already authorized reads',()=>{
 const fence=new TeamSendReadFence('conversation-key');fence.begin('old');fence.invalidate(undefined);fence.begin('new')
 expect(fence.projectAcknowledgement(sent,'old').content).toBeUndefined()
 expect(fence.projectAcknowledgement(sent,'new')).toBe(sent)
 const covered=new TeamSendReadFence('conversation-key');covered.begin('send');covered.invalidate(undefined)
 expect(covered.projectAcknowledgement(sent,'send',sent)).toBe(sent)
})
it('retains the strongest source fence and conservatively handles bounded eviction',()=>{
 const fence=new TeamSendReadFence('conversation-key');fence.begin('send')
 fence.invalidate({kind:'team.message.changed',messageKey:sent.key,messageRevision:3})
 fence.invalidate({kind:'team.message.changed',messageKey:sent.key,messageRevision:1})
 expect(fence.projectAcknowledgement(sent,'send').content).toBeUndefined()
 fence.begin('old')
 for(let i=0;i<64;i++)fence.invalidate({kind:'team.message.changed',messageKey:`other-${i}`,messageRevision:1})
 expect(fence.projectAcknowledgement(sent,'old').content).toBeUndefined()
 fence.begin('new');expect(fence.projectAcknowledgement(sent,'new')).toBe(sent)
})
it('does not blank ordinary sends after the bounded source history fills',()=>{
 const fence=new TeamSendReadFence('conversation-key')
 for(let i=0;i<130;i++){
  const message={...sent,key:`sent-${i}`}
  fence.begin(`op-${i}`)
  fence.invalidate({kind:'team.message.changed',messageKey:message.key,messageRevision:2})
  expect(fence.projectAcknowledgement(message,`op-${i}`)).toBe(message)
 }
})
it('prefers an authorized body over metadata, but does not replace a newer Record body',()=>{
 const fence=new TeamSendReadFence('conversation-key');fence.begin('send')
 const {content,...identity}=sent
 const denied={...identity,version:0,contentStatus:'unavailable'}
 expect(fence.projectAcknowledgement(denied,'send',sent)).toBe(sent)
 const newer={...sent,version:sent.version+1,content:{text_content:'newer body'}}
 fence.begin('send2');expect(fence.projectAcknowledgement(newer,'send2',sent)).toBe(newer)
})
it('removes only the affected source or parent material, preserving an independent child body',()=>{
 const child:TeamMessage={key:'child',ref:'child-ref',seq:2,revision:1,side:'team',sender:{nickname:'作者'},own:true,state:'published',createdAt:1,canEdit:true,canDelete:true,version:4,contentStatus:'available',content:{text_content:'独立回复'},media:[],reply:{key:'parent',ref:'parent-ref',seq:1,version:3,state:'available',sender:{nickname:'父作者'},text:'父正文',title:'父标题',media:[]}}
 expect(invalidateTeamMessageRead(child,{kind:'team.message.changed',messageKey:'other'},'conversation-key')).toBe(child)
 const parent=invalidateTeamMessageRead(child,{kind:'team.message.changed',messageKey:'parent'},'conversation-key')
 expect(parent.content).toBe(child.content);expect(parent.version).toBe(4)
 expect(parent.reply).toMatchObject({ref:'parent-ref',key:'parent',state:'unavailable',text:''})
 expect(parent.reply).not.toHaveProperty('title');expect(parent.reply).not.toHaveProperty('media')
 const own=invalidateTeamMessageRead(child,{kind:'team.message.changed',messageKey:'child'},'conversation-key')
 expect(own.content).toBeUndefined();expect(own.reply).toBeUndefined()
 expect(own.contentStatus).toBe('revalidating')
})
afterEach(()=>{stop?.();stop=undefined;call.mockReset()})
it('keeps an already-granted media reader for represented revisions and rechecks a newer change',async()=>{
 call.mockResolvedValue([])
 const listener=vi.fn();stop=watchTeamSourceRead({...target,revision:2},listener)
 await vi.waitFor(()=>expect(listener).toHaveBeenLastCalledWith({status:'available'}))
 for(const messageRevision of [2,1,2])invalidateTeamMessages(target.accountKey,false,{kind:'team.message.changed',messageKey:target.messageKey,conversationKeys:[target.conversationKey],messageRevision})
 expect(call).toHaveBeenCalledTimes(1)
 invalidateTeamMessages(target.accountKey,false,{kind:'team.message.changed',messageKey:target.messageKey,conversationKeys:[target.conversationKey],messageRevision:3})
 expect(listener).toHaveBeenLastCalledWith({status:'checking'})
 await vi.waitFor(()=>expect(call).toHaveBeenCalledTimes(2))
})
it.each(['team.notification-policy.changed','team.receipt.changed','team.reaction.changed','team.annotation.changed','team.profile.changed','team.channel.changed','team.message.published'])('does not reread a published source for %s',kind=>{
 expect(teamChangeAffectsSource({kind},target)).toBe(false)
})
it('distinguishes other messages and conversations from current or unknown access changes',()=>{
 expect(teamChangeAffectsSource({kind:'team.message.changed',messageKey:'other'},target)).toBe(false)
 expect(teamChangeAffectsSource({kind:'team.access.changed',conversationKeys:['other']},target)).toBe(false)
 expect(teamChangeAffectsSource({kind:'team.message.changed',messageKey:target.messageKey},target)).toBe(true)
 expect(teamChangeAffectsSource({kind:'team.access.changed',conversationKeys:[target.conversationKey]},target)).toBe(true)
 expect(teamChangeAffectsSource({kind:'team.access.changed'},target)).toBe(true)
 expect(teamChangeAffectsSource(undefined,target)).toBe(true)
 expect(teamChangeAffectsSource({kind:'future-kind'},target)).toBe(true)
})
it.each(['team-message_recalled','team-not_accessible','team-version_conflict','team-reference-invalid','team-account-changed','login-required'])('rejects the frozen source on definitive %s',async code=>{
 call.mockRejectedValue({body:{code}})
 const listener=vi.fn();stop=watchTeamSourceRead(target,listener)
 await vi.waitFor(()=>expect(listener).toHaveBeenLastCalledWith({status:'revoked'}))
 expect(call).toHaveBeenCalledWith('team.app.preflight',{conversationRef:'conversation',expectedAccountKey:'test:42',selections:[{messageRef:'message',version:3}]},expect.any(AbortSignal))
})
it('rechecks an unknown reconnect, leaves healthy focus alone, and aborts the disposed lifetime',async()=>{
 call.mockResolvedValue([])
 const listener=vi.fn();stop=watchTeamSourceRead(target,listener)
 await vi.waitFor(()=>expect(listener).toHaveBeenLastCalledWith({status:'available'}))
 window.dispatchEvent(new Event('focus'));expect(call).toHaveBeenCalledTimes(1)
 window.dispatchEvent(new Event('online'))
 await vi.waitFor(()=>expect(call).toHaveBeenCalledTimes(2))
 invalidateTeamMessages('test:42')
 await vi.waitFor(()=>expect(call).toHaveBeenCalledTimes(3))
 stop();expect(call.mock.calls[0]![2].aborted).toBe(true)
 const count=call.mock.calls.length;invalidateTeamMessages('test:42');expect(call).toHaveBeenCalledTimes(count)
})
