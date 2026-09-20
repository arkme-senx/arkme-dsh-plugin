import { describe, expect, it, vi } from 'vitest'
import { patchChatPolicy } from '../../src/services/chat-policy.js'
import type { ServiceRuntime } from '../../src/services/service.js'

const session = { userId: 42, accessToken: 'access', refreshToken: 'refresh' }
const policy = { chat_session_uid: 'chat-1', user_id: 42, show_in_home_state: 2, privacy_state: 2, mute_state: 2, pin_state: 2, notify_state: 2, status: 3, update_at: 1000 }
function fixture(reply = policy) {
 const post = vi.fn().mockResolvedValue(reply)
 const requireSession = vi.fn().mockResolvedValue(session)
 return { post, requireSession, runtime: { authenticatedChatPost: post, requireSession } as unknown as ServiceRuntime }
}
describe('Chat policy field intent', () => {
 it('only sends pin intent, accepts unrelated concurrent settings and the server clock', async () => {
  const { post, runtime } = fixture()
  await expect(patchChatPolicy(runtime,session,'chat-1',{pin_state:2})).resolves.toEqual(policy)
  expect(post).toHaveBeenCalledExactlyOnceWith('/api/v1/chats/policy/update',{chat_session_uid:'chat-1',patch:{pin_state:2}},session,undefined)
 })
 it.each([{}, { ...policy,user_id:43 }, { ...policy,update_at:'1000' }, { ...policy,mute_state:0 }])('rejects invalid acknowledgements %j', async reply => {
  const {runtime}=fixture(reply as typeof policy)
  await expect(patchChatPolicy(runtime,session,'chat-1',{pin_state:2})).rejects.toMatchObject({code:'chat-policy-result-invalid'})
 })
 it('rejects a mismatched effective target',async()=>{
  const {runtime}=fixture({...policy,pin_state:1})
  await expect(patchChatPolicy(runtime,session,'chat-1',{pin_state:2})).rejects.toMatchObject({code:'chat-policy-conflict'})
 })
 it('does not publish acknowledgement into another account',async()=>{
  const {runtime,requireSession}=fixture();requireSession.mockResolvedValue({...session,userId:43})
  await expect(patchChatPolicy(runtime,session,'chat-1',{pin_state:2})).rejects.toMatchObject({code:'login-context-changed'})
 })
 it('does not retry a failed patch with a snapshot',async()=>{
  const {runtime,post}=fixture();post.mockRejectedValue(new Error('unsupported'))
  await expect(patchChatPolicy(runtime,session,'chat-1',{pin_state:2})).rejects.toThrow('unsupported')
  expect(post).toHaveBeenCalledTimes(1)
 })
})
