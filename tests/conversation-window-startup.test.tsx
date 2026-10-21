// @vitest-environment jsdom
import React from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ArkmeConversationWindow } from '../src/client/ArkmeConversationWindow.js'
import { arkmeAuthStore } from '../src/client/auth-store.js'
import { arkmeUi } from '../src/client/ui-controller.js'
import { arkmeAvatarImages } from '../src/client/avatar-image-runtime.js'
import { callArkme } from '../src/client/api.js'
vi.mock('../src/client/ArkmeSidebar.js', async () => {
 const {arkmeAvatarImages}=await import('../src/client/avatar-image-runtime.js')
 return { ArkmeSurface: ({conversationBootstrap}: any) => <div data-test-conversation>{conversationBootstrap?.content?.timeline.items.map((item: any) =>
  <p key={item.itemUid}>{item.textContent}{item.avatarRef && arkmeAvatarImages.current(item.avatarRef) && <img src={arkmeAvatarImages.current(item.avatarRef)} />}</p>)}</div> }
})
vi.mock('../src/client/realtime-client-events.js', () => ({useArkmeRealtimeClientEvents: () => {}}))
vi.mock('../src/client/api.js', () => ({callArkme: vi.fn()}))
const auth = {status:'authenticated' as const, environment:'prod' as const, userId:7}
const source = {kind:'group_chat' as const, sourceKey:'chat:one', sourceRef:'ref', displayName:'测试群'}
const seed = {version:1 as const, accountKey:'prod:7', sourceKey:'chat:one', auth,
 content:{timeline:{items:[{itemUid:'one',textContent:'已有消息'}],aiPolishNotices:[],hasMore:false}}}
let view: ReactTestRenderer | undefined
let bridge: any
function deferred<T>() { let resolve!: (value:T)=>void; let reject!: (error:Error)=>void
 const promise = new Promise<T>((yes,no)=>{resolve=yes;reject=no}); return {promise,resolve,reject} }
async function flush() { await act(async () => { await Promise.resolve(); await Promise.resolve() }) }
beforeEach(() => {
 vi.mocked(callArkme).mockReset()
 arkmeAvatarImages.activateScope(undefined)
 arkmeAuthStore.setAuth({status:'logged-out',environment:'prod'})
 bridge = {version:1,bootstrapVersion:1,context:vi.fn(async()=>({accountKey:'prod:7',sourceKey:'chat:one',source,bootstrap:seed})),active:vi.fn(async()=>true)}
 vi.stubGlobal('arkmeConversation',bridge)
})
afterEach(async () => { await act(async()=>{view?.unmount()}); view=undefined; vi.unstubAllGlobals(); vi.restoreAllMocks() })
describe('independent conversation startup', () => {
 it('paints cached messages before auth/network refresh completes and preserves them after failure with a working retry', async () => {
  const status = deferred<typeof auth>()
  vi.mocked(callArkme).mockImplementation(async method => method === 'auth.status' ? await status.promise : {environment:'prod'})
  await act(async()=>{view=create(<ArkmeConversationWindow/>)}); await flush()
  expect(view!.root.findByType('section').props['data-arkme-workspace']).toBe(true)
  expect(view!.root.findAllByType('p')[0]?.children[0]).toBe('已有消息')
  expect(view!.root.findAllByProps({role:'alert'})).toHaveLength(0)
  expect(arkmeUi.getSnapshot().selectedSource?.sourceKey).toBe('chat:one')
  status.reject(new Error('offline')); await flush()
  expect(view!.root.findAllByType('p')).toHaveLength(1)
  expect(view!.root.findByProps({role:'alert'}).children.join('')).toContain('同步失败')
  vi.mocked(callArkme).mockImplementation(async method => method === 'auth.status' ? auth : {environment:'prod'})
  await act(async()=>{view!.root.findByType('button').props.onClick()}); await flush()
  expect(view!.root.findAllByProps({role:'alert'})).toHaveLength(0)
  expect(view!.root.findAllByType('p')).toHaveLength(1)
 })
 it('installs cached avatar bytes before the message surface mounts while all remote reads remain pending', async () => {
  const data='data:image/png;base64,YQ=='
  bridge.context.mockResolvedValue({...await bridge.context(),bootstrap:{...seed,content:{...seed.content,
   timeline:{...seed.content.timeline,items:[{itemUid:'one',textContent:'已有消息',avatarRef:'avatar'}]},
   avatars:[{cacheKey:'avatar',reference:'avatar',value:data,expiresAtMillis:Date.now()+60_000}]}}})
  const status=deferred<any>()
  vi.mocked(callArkme).mockImplementation(async method=>method==='auth.status'?await status.promise:{environment:'prod'})
  await act(async()=>{view=create(<ArkmeConversationWindow/>)}); await flush()
  expect(view!.root.findByType('img').props.src).toBe(data)
  expect(view!.root.findAllByProps({'data-test-conversation':true})).toHaveLength(1)
  status.resolve(auth); await flush()
 })
 it('removes the cached conversation immediately when auth explicitly expires', async () => {
  const status=deferred<any>()
  vi.mocked(callArkme).mockImplementation(async method => method === 'auth.status' ? await status.promise : {environment:'prod'})
  await act(async()=>{view=create(<ArkmeConversationWindow/>)}); await flush()
  expect(view!.root.findAllByType('p')).toHaveLength(1)
  status.resolve({status:'expired',environment:'prod'}); await flush()
  expect(view!.root.findAllByType('p')).toHaveLength(0)
  expect(view!.root.findByProps({role:'alert'}).children.join('')).toContain('失效')
 })
 it('retains the original auth-first fallback on an older shell with no seed', async () => {
  bridge.context.mockResolvedValue({accountKey:'prod:7',sourceKey:'chat:one',source})
  const status=deferred<typeof auth>()
  vi.mocked(callArkme).mockImplementation(async method=>method==='auth.status'?await status.promise:{environment:'prod'})
  await act(async()=>{view=create(<ArkmeConversationWindow/>)}); await flush()
  expect(view!.root.findAllByProps({'data-test-conversation':true})).toHaveLength(0)
  status.resolve(auth); await flush()
  expect(view!.root.findAllByProps({'data-test-conversation':true})).toHaveLength(1)
 })
 it('does not reveal a stale seed for an inactive account scope', async () => {
  bridge.active.mockResolvedValue(false)
  await act(async()=>{view=create(<ArkmeConversationWindow/>)}); await flush()
  expect(view!.root.findAllByType('p')).toHaveLength(0)
  expect(callArkme).not.toHaveBeenCalled()
 })
})
