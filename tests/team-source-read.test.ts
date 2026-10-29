// @vitest-environment jsdom
import {afterEach,expect,it,vi} from 'vitest'
import {teamChangeAffectsSource,watchTeamSourceRead} from '../src/client/team-source-read.js'
import {invalidateTeamMessages} from '../src/client/team-messaging-events.js'
const call=vi.hoisted(()=>vi.fn())
vi.mock('../src/client/api.js',()=>({callArkme:call}))
const target={accountKey:'test:42',conversationRef:'conversation',conversationKey:'conversation-key',messageRef:'message',messageKey:'message-key',version:3}
let stop:(()=>void)|undefined
afterEach(()=>{stop?.();stop=undefined;call.mockReset()})
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
