import { arkmeAvatarImages } from '../src/client/avatar-image-runtime.js'
import { afterEach, describe, expect, it } from 'vitest'
import { arkmeAuthStore } from '../src/client/auth-store.js'
import { ArkmeConversationMemoryCache, arkmeShouldRefreshChatTimeline } from '../src/client/conversation-memory-cache.js'
import { readConversationWindowBootstrap, readConversationWindowContent, registerConversationWindowContent, restoreConversationWindowContent, validConversationWindowBootstrap } from '../src/client/conversation-window-bootstrap.js'
import type { ArkmeConversationTimelineSnapshot } from '../src/client/conversation-memory-cache.js'

const timeline: ArkmeConversationTimelineSnapshot = { items: [{ itemUid: 'one', senderName: '张三', isMe: false,
  sendAtMillis: 1, title: '', textContent: '本地已有内容', status: 1, sequence: 8 }], aiPolishNotices: [],
  fetchedAtMillis: Date.now(), latestSequence: 8, mode: 'around', aroundSequenceRange: { minimumSequence: 8, maximumSequence: 8 }, hasMore: true, nextCursor: { beforeSequence: 8 } }
let stop: (() => void) | undefined
afterEach(() => { stop?.(); stop = undefined; arkmeAuthStore.setAuth({status: 'logged-out', environment: 'prod'}) })
describe('conversation window local bootstrap', () => {
 it('copies only the requested same-account projection, cursors and reading anchor without sharing mutable objects', () => {
  arkmeAuthStore.setAuth({status: 'authenticated', environment: 'prod', userId: 7, qrContent: 'never-transfer', attemptId: 'never-transfer'})
  const main = new ArkmeConversationMemoryCache()
  main.storeTimeline('chat:one', timeline)
  main.storeTimeline('chat:two', {...timeline, items: []})
  main.storeViewport('chat:one', {scrollTop: 125, stickToBottom: false, anchorId: 'message:one', anchorOffset: -8})
  main.storeInterwovenState('chat:one', 'partial')
  stop = registerConversationWindowContent('prod:7', key => readConversationWindowContent(main, key))
  const seed = readConversationWindowBootstrap('prod:7', 'chat:one')!
  expect(seed.auth).toEqual({status: 'authenticated', environment: 'prod', userId: 7})
  expect(seed.content?.timeline.items[0]?.textContent).toBe('本地已有内容')
  const child = new ArkmeConversationMemoryCache()
  restoreConversationWindowContent(child, seed.sourceKey, seed.content!)
  expect(child.getViewport('chat:one')).toEqual(main.getViewport('chat:one'))
  expect(child.getTimeline('chat:one')?.nextCursor).toEqual({beforeSequence: 8})
  expect(child.getInterwovenState('chat:one')).toBe('partial')
  expect(child.getTimeline('chat:two')).toBeUndefined()
  expect(arkmeShouldRefreshChatTimeline(child.getTimeline('chat:one'), Date.now(), 8)).toBe(true)
  seed.content!.timeline.items[0]!.textContent = 'changed in child'
  expect(main.getTimeline('chat:one')?.items[0]?.textContent).toBe('本地已有内容')
 })
 it('rejects account/environment/conversation mismatches and clears the projection on provider disposal', () => {
  arkmeAuthStore.setAuth({status:'authenticated', environment:'prod', userId:7})
  stop = registerConversationWindowContent('prod:7', () => ({timeline}))
  const seed = readConversationWindowBootstrap('prod:7', 'chat:one')!
  expect(validConversationWindowBootstrap(seed, 'prod:7', 'chat:one')).toBe(true)
  expect(validConversationWindowBootstrap(seed, 'test:7', 'chat:one')).toBe(false)
  expect(validConversationWindowBootstrap(seed, 'prod:8', 'chat:one')).toBe(false)
  expect(validConversationWindowBootstrap(seed, 'prod:7', 'chat:two')).toBe(false)
  expect(readConversationWindowBootstrap('test:7', 'chat:one')).toBeUndefined()
  stop()
  expect(readConversationWindowBootstrap('prod:7', 'chat:one')?.content).toBeUndefined()
 })
 it('includes cached message, self-role, self-profile and header avatars without copying unrelated images', () => {
  arkmeAuthStore.setAuth({status:'authenticated',environment:'prod',userId:7})
  arkmeAvatarImages.activateScope('prod:7')
  const refs=['message','role','self','header','group-slot','unrelated']
  arkmeAvatarImages.restore?.('prod:7',refs.map(ref=>({cacheKey:ref,reference:ref,value:'data:image/png;base64,YQ==',expiresAtMillis:Date.now()+60_000})))
  stop=registerConversationWindowContent('prod:7',()=>({timeline:{...timeline,items:[{...timeline.items[0]!,avatarRef:'message',selfRole:{avatarRef:'role'} as any}]},selfAvatarRef:'self'}))
  const seed=readConversationWindowBootstrap('prod:7','chat:one',{avatarRef:'header',groupAvatar:{slots:[{avatarRef:'group-slot'}]}} as any)!
  expect(seed.content?.avatars?.map(image=>image.reference)).toEqual(['message','role','self','header','group-slot'])
  expect(seed.content?.selfAvatarRef).toBe('self')
  arkmeAvatarImages.activateScope(undefined)
 })
 it('drops optional image bytes before dropping a message projection near the IPC limit', () => {
  arkmeAuthStore.setAuth({status:'authenticated',environment:'prod',userId:7})
  arkmeAvatarImages.activateScope('prod:7')
  arkmeAvatarImages.restore?.('prod:7',[{cacheKey:'large',reference:'large',value:'data:image/png;base64,'+'A'.repeat(100_000),expiresAtMillis:Date.now()+60_000}])
  stop=registerConversationWindowContent('prod:7',()=>({timeline:{...timeline,items:[{...timeline.items[0]!,avatarRef:'large',textContent:'a'.repeat(1_920_000)}]}}))
  const seed=readConversationWindowBootstrap('prod:7','chat:one')!
  expect(seed.content?.timeline.items[0]?.textContent.length).toBe(1_920_000)
  expect(seed.content?.avatars).toBeUndefined()
  arkmeAvatarImages.activateScope(undefined)
 })
 it('keeps the local-session fast path if the message projection exceeds the IPC limit', () => {
  arkmeAuthStore.setAuth({status:'authenticated', environment:'prod', userId:7})
  stop = registerConversationWindowContent('prod:7', () => ({timeline: {...timeline,
    items: [{...timeline.items[0]!, textContent: '字'.repeat(700_000)}]}}))
  const seed = readConversationWindowBootstrap('prod:7', 'chat:one')!
  expect(seed.auth.userId).toBe(7)
  expect(seed.content).toBeUndefined()
 })
 it('keeps opening available when an optional cache provider fails', () => {
  arkmeAuthStore.setAuth({status:'authenticated', environment:'prod', userId:7})
  stop = registerConversationWindowContent('prod:7', () => { throw new Error('view disposed') })
  expect(readConversationWindowBootstrap('prod:7', 'chat:one')?.auth.userId).toBe(7)
  expect(readConversationWindowBootstrap('prod:7', 'chat:one')?.content).toBeUndefined()
 })
 it('does not transfer a projection from a previous account after switching users', () => {
  stop = registerConversationWindowContent('prod:7', () => ({timeline}))
  arkmeAuthStore.setAuth({status:'authenticated', environment:'prod', userId:8})
  expect(readConversationWindowBootstrap('prod:7', 'chat:one')).toBeUndefined()
  expect(readConversationWindowBootstrap('prod:8', 'chat:one')?.content).toBeUndefined()
 })
})
