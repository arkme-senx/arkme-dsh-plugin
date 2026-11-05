import { afterEach, expect, it, vi } from 'vitest'
import { arkmeAuthStore } from '../src/client/auth-store.js'
import { bindLongArticleWindowAccount, openLongArticleWindow } from '../src/client/long-article-window.js'
const source = { sourceKey: 'chat:A', sourceRef: 'signed-A', displayName: 'A' }
afterEach(() => vi.unstubAllGlobals())
it('preserves the browser fallback when the native bridge is unavailable', async () => {
  vi.stubGlobal('arkmeLongArticle', undefined)
  expect(await openLongArticleWindow(source)).toBe(false)
})
it('passes the original account and source to the native window', async () => {
  arkmeAuthStore.setAuth({ status: 'authenticated', userId: 7, environment: 'prod' })
  const open = vi.fn(async () => true), account = vi.fn(async () => true)
  vi.stubGlobal('arkmeLongArticle', { version: 1, open, account })
  expect(await openLongArticleWindow(source)).toBe(true)
  expect(open).toHaveBeenCalledWith({ ...source, accountKey: 'prod:7' })
})
it('does not open after the account changes while opening', async () => {
  arkmeAuthStore.setAuth({ status: 'authenticated', userId: 7, environment: 'prod' })
  const open = vi.fn()
  vi.stubGlobal('arkmeLongArticle', { version: 1, open, account: async () => {
    arkmeAuthStore.setAuth({ status: 'authenticated', userId: 8, environment: 'prod' }); return true
  } })
  await expect(openLongArticleWindow(source)).rejects.toThrow('账号已切换')
  expect(open).not.toHaveBeenCalled()
})
it('notifies native windows on logout and unsubscribes cleanly', () => {
  arkmeAuthStore.setAuth({ status: 'authenticated', userId: 7, environment: 'prod' })
  const account = vi.fn(async () => true)
  vi.stubGlobal('arkmeLongArticle', { version: 1, account })
  const stop = bindLongArticleWindowAccount()
  arkmeAuthStore.setAuth({ status: 'logged-out', environment: 'prod' })
  expect(account).toHaveBeenLastCalledWith(null)
  stop(); const count = account.mock.calls.length
  arkmeAuthStore.setAuth({ status: 'authenticated', userId: 9, environment: 'prod' })
  expect(account).toHaveBeenCalledTimes(count)
})

it('falls back for existing articles on a create-only bridge', async () => {
 const open = vi.fn(); vi.stubGlobal('arkmeLongArticle', { version: 1, open })
 const item = { itemUid: 'a', title: 'a', textContent: '', isMe: true, senderName: '我', status: 1, sendAtMillis: 1 }
 expect(await openLongArticleWindow(source, { mode: 'existing', item })).toBe(false)
 expect(open).not.toHaveBeenCalled()
})

it('uses v3 browsing targets and preserves location context while older clients fall back', async () => {
  const { openBrowseWindow } = await import('../src/client/long-article-window.js')
  arkmeAuthStore.setAuth({ status: 'authenticated', userId: 7, environment: 'prod' })
  const open = vi.fn(async () => true), account = vi.fn(async () => true)
  vi.stubGlobal('arkmeLongArticle', { version: 2, open, account })
  expect(await openBrowseWindow('location')).toBe(false)
  expect(open).not.toHaveBeenCalled()
  vi.stubGlobal('arkmeLongArticle', { version: 3, open, account })
  const location = { initialDate: { bucketDate: '2026-10-26', timezone: 'Asia/Shanghai' } }
  expect(await openBrowseWindow('location', location)).toBe(true)
  expect(open).toHaveBeenCalledWith({ accountKey: 'prod:7', sourceKey: 'browse:location', sourceRef: 'browse:location', displayName: '位置', surface: 'location', location })
})
it('opens library articles without attempting to bind the main window account from a child', async () => {
  arkmeAuthStore.setAuth({ status: 'authenticated', userId: 7, environment: 'prod' })
  vi.stubGlobal('location', { search: '?arkmeLongArticle=1' })
  const open = vi.fn(async () => true), account = vi.fn(), active = vi.fn(async () => true)
  vi.stubGlobal('arkmeLongArticle', { version: 3, open, account, active })
  expect(await openLongArticleWindow(source, undefined, true)).toBe(true)
  expect(account).not.toHaveBeenCalled()
  expect(open).toHaveBeenCalledWith({ ...source, accountKey: 'prod:7', autoPublish: true })
  active.mockResolvedValue(false)
  await expect(openLongArticleWindow(source)).rejects.toThrow('账号已切换')
})

it('discards a queued navigation when its originating account is no longer current', async () => {
  const { arkmeUi } = await import('../src/client/ui-controller.js')
  const navigate = vi.spyOn(arkmeUi, 'showConversationTarget').mockImplementation(() => {})
  let listener: any
  arkmeAuthStore.setAuth({ status: 'authenticated', userId: 7, environment: 'prod' })
  vi.stubGlobal('arkmeLongArticle', { version: 3, account: async () => true,
    onNavigate: (callback: unknown) => { listener = callback; return () => {} } })
  const stop = bindLongArticleWindowAccount()
  const value = { source, accountKey: 'prod:7', recordUid: 'record', sendAtMillis: 1 }
  listener(value); expect(navigate).toHaveBeenCalledOnce()
  arkmeAuthStore.setAuth({ status: 'authenticated', userId: 8, environment: 'prod' })
  listener(value); expect(navigate).toHaveBeenCalledOnce()
  stop(); navigate.mockRestore()
})

it.each([1,2,3])('keeps represented composition in the original native v%s window despite its target whitelist', async(version)=>{
  const {longArticleWindowBridge}=await import('../src/client/long-article-window.js')
  arkmeAuthStore.setAuth({status:'authenticated',userId:7,environment:'prod'})
  let nativeTarget:any,created:((value:any)=>void)|undefined
  const open=vi.fn(async(raw:any)=>{nativeTarget={accountKey:raw.accountKey,sourceKey:raw.sourceKey,sourceRef:raw.sourceRef,displayName:raw.displayName};return true})
  vi.stubGlobal('arkmeLongArticle',{version,open,account:async()=>true,context:async()=>nativeTarget,onCreated:(listener:any)=>{created=listener;return()=>{created=undefined}}})
  const composition={draftScope:'team-7',representation:{teamRef:'sealed-team-7',membershipKind:'member' as const,membershipRevision:3,groupJoinAt:9}}
  expect(await openLongArticleWindow(source,undefined,false,composition)).toBe(true)
  expect(nativeTarget).not.toHaveProperty('composition')
  expect(nativeTarget.sourceRef).not.toBe(source.sourceRef)
  expect(nativeTarget.sourceKey).not.toBe(source.sourceKey)
  const bridge=longArticleWindowBridge()!
  expect(await bridge.context()).toEqual({...source,accountKey:'prod:7',composition})
  const onCreated=vi.fn(),stop=bridge.onCreated(onCreated)
  created!({...nativeTarget,item:{itemUid:'accepted',representation:composition.representation}})
  expect(onCreated).toHaveBeenCalledWith({...source,accountKey:'prod:7',composition,item:{itemUid:'accepted',representation:composition.representation}})
  const teamKey=nativeTarget.sourceKey
  await openLongArticleWindow(source,undefined,false,{...composition,representation:{...composition.representation,teamRef:'rotated-team-7'}})
  expect(nativeTarget.sourceKey).toBe(teamKey)
  await openLongArticleWindow(source,undefined,false,{...composition,draftScope:'team-8',representation:{...composition.representation,teamRef:'sealed-team-8'}})
  expect(nativeTarget.sourceKey).not.toBe(teamKey)
  stop()
})
it('rejects broken represented window context before opening rather than publishing as personal', async()=>{
  arkmeAuthStore.setAuth({status:'authenticated',userId:7,environment:'prod'})
  const open=vi.fn(async()=>true)
  vi.stubGlobal('arkmeLongArticle',{version:3,open,account:async()=>true})
  await expect(openLongArticleWindow(source,undefined,false,{draftScope:'team',representation:{teamRef:'',membershipKind:'member',membershipRevision:3,groupJoinAt:9}})).rejects.toThrow()
  expect(open).not.toHaveBeenCalled()
})

it('fails closed when the native return loses one half of the represented context', async()=>{
 const {longArticleWindowBridge}=await import('../src/client/long-article-window.js')
 arkmeAuthStore.setAuth({status:'authenticated',userId:7,environment:'prod'})
 let target:any
 vi.stubGlobal('arkmeLongArticle',{version:3,open:async(raw:any)=>{target=raw;return true},account:async()=>true,context:async()=>({...target,sourceRef:source.sourceRef})})
 await openLongArticleWindow(source,undefined,false,{draftScope:'team',representation:{teamRef:'sealed',membershipKind:'member',membershipRevision:3,groupJoinAt:9}})
 await expect(longArticleWindowBridge()!.context()).rejects.toThrow('上下文已失效')
})
