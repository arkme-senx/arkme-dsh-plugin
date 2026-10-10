import { arkmeChatDirectory } from './chat-directory-store.js'
import { composerArticleStore, type ComposerArticleStore } from './composer-article-store.js'
import { outgoingCallUi } from './outgoing-call-ui-controller.js'
import { arkmeComposerDraftStore, type ArkmeComposerDraftStore } from './composer-draft-store.js'
import { arkmeAuthStore } from './auth-store.js'
import { arkmeUi } from './ui-controller.js'
import { conversationAccountKey, conversationWindowBridge, conversationWindowRequested, type ConversationWindowBridge } from './conversation-window.js'
let pending: Promise<unknown> = Promise.resolve()
const draftFlushers = new Set<() => void>()
async function flushDrafts(): Promise<void> {
 while (true) {
  for (const flush of draftFlushers) flush()
  const current = pending
  await current
  for (const flush of draftFlushers) flush()
  if (current === pending) return
 }
}
const busy = new Set<string>()
const listeners = new Set<() => void>()
let revision = 0
export const conversationSending = {
 subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } },
 getRevision: () => revision,
 has: (key: string | undefined) => key !== undefined && busy.has(key),
}
function notifyBusy(key: string, value: boolean) {
 if (value) busy.add(key); else busy.delete(key)
 revision++; for (const listener of listeners) listener()
}
export async function connectConversationDrafts(bridge: ConversationWindowBridge, store: ArkmeComposerDraftStore, userId: number, accountKey: string, articles: ComposerArticleStore = composerArticleStore): Promise<() => void> {
 const prefix = `arkme-composer:${userId}:source:`
 let applying = false, stopped = false
 const hydrated = new Set<string>()
 let previous = new Map(store.entries())
 const queued = new Map<string, unknown>()
 let publishTimer: ReturnType<typeof setTimeout> | undefined
 let previousArticles = articles.entries()
 const articlePrefix = `${accountKey}:${prefix}`
 const apply = (event: Awaited<ReturnType<ConversationWindowBridge['snapshot']>>[number]) => {
  if (stopped || (event.accountKey !== undefined && event.accountKey !== accountKey)) return
  if (event.kind === 'busy') { notifyBusy(event.key,event.value); return }
  if (event.kind === 'article' && event.key.startsWith(articlePrefix)) {
    hydrated.add(event.key)
    applying = true; try { articles.applyRemote(event.key,event.value); previousArticles = articles.entries() } finally { applying = false }; return
  }
  if (event.kind !== 'draft' || !event.key.startsWith(prefix)) return
  hydrated.add(event.key)
  // A received snapshot predates local edits that have not reached the broker yet.
  if (queued.has(event.key)) return
  applying = true
  try { store.applyRemote(event.key,event.value); previous = new Map(store.entries()) } finally { applying = false }
 }
 let booting = true
 const buffered: Parameters<typeof apply>[0][] = []
 const stopEvents = bridge.onEvent(event => { if (booting) buffered.push(event); else apply(event) })
 try { for (const event of await bridge.snapshot(accountKey)) apply(event); for (const event of buffered) apply(event); booting = false } catch (error) { stopEvents(); throw error }
 const publish = (key: string, value: unknown, kind: 'draft' | 'article' = 'draft') => {
  const request = bridge.publish({kind,key,value},accountKey)
  pending = Promise.all([pending, request]).catch(() => undefined)
 }
 for (const [key,value] of store.entries()) if (key.startsWith(prefix) && !hydrated.has(key)) publish(key,value)
 for (const [key,value] of articles.entries()) if (key.startsWith(articlePrefix) && !hydrated.has(key)) publish(key,value,'article')
 const stopArticles = articles.subscribe(() => {
  if (applying || stopped) return
  const next = articles.entries()
  for (const key of new Set([...previousArticles.keys(),...next.keys()])) if (key.startsWith(articlePrefix) && previousArticles.get(key) !== next.get(key)) publish(key,next.get(key) ?? null,'article')
  previousArticles = next
 })
 const flush = () => {
  if (publishTimer !== undefined) clearTimeout(publishTimer)
  publishTimer = undefined
  for (const [key, value] of queued) publish(key, value)
  queued.clear()
 }
 draftFlushers.add(flush)
 if (typeof window !== 'undefined') window.addEventListener('pagehide', flush)
 const stopStore = store.subscribe(changedKey => {
  if (applying || stopped) return
  const next = changedKey === undefined ? store.entries() : undefined
  const keys = changedKey === undefined ? new Set([...previous.keys(), ...next!.keys()]) : [changedKey]
  for (const key of keys) {
   if (!key.startsWith(prefix)) continue
   const draft = store.get(key)
   const value = draft.text === '' && draft.attachments.length === 0 && draft.markdown === undefined ? null : draft
   // Object URLs belong to their creating page; receivers resolve previews from the asset/file reference.
   queued.set(key, value ? {...value, attachments: value.attachments.map(({previewUrl: _preview, ...item}) => item)} : null)
   if (value === null) previous.delete(key); else previous.set(key, value)
  }
  if (next !== undefined) previous = new Map(next)
  // A fixed window coalesces edits without postponing replication during continuous typing.
  publishTimer ??= setTimeout(flush, 40)
 })

 return () => { flush(); draftFlushers.delete(flush); if (typeof window !== 'undefined') window.removeEventListener('pagehide', flush); stopped = true; stopEvents(); stopStore(); stopArticles(); busy.clear(); revision++; for (const listener of listeners) listener() }
}
export function bindConversationWindows(): () => void {
 const bridge = conversationWindowBridge(); if (!bridge) return () => {}
 let generation = 0, account: string | null | undefined, stopDrafts: (() => void) | undefined
 const changed = () => {
  const next = conversationAccountKey(); if (next === account) return
  account = next; const run = ++generation; stopDrafts?.(); stopDrafts = undefined
  void (async () => {
   if (!conversationWindowRequested()) await bridge.account(next)
   const userId = arkmeAuthStore.getSnapshot().auth?.userId
   if (run !== generation || !next || userId === undefined) return
   const stop = await connectConversationDrafts(bridge,arkmeComposerDraftStore,userId,next)
   if (run === generation) stopDrafts = stop; else stop()
  })().catch(() => {})
 }
 let receiving = false, lastRecord = arkmeUi.getRecordRevision()
 const stopEvents = bridge.onEvent(event => {
  if (event.accountKey !== undefined && event.accountKey !== conversationAccountKey()) return
  if (event.kind === 'call' && !conversationWindowRequested()) outgoingCallUi.request({sourceRef:event.source.sourceRef,displayName:event.source.displayName,mediaType:event.mediaType})
  if (event.kind === 'activate' && !conversationWindowRequested()) {
   if (event.source.kind === 'private_chat' || event.source.kind === 'group_chat') arkmeChatDirectory.upsert(event.source)
   arkmeUi.selectSource(event.source)
   arkmeUi.chatChanged()
  }
  if (event.kind !== 'changed') return
  receiving = true
  try { arkmeUi.recordChanged(); arkmeUi.chatChanged() } finally { receiving = false; lastRecord = arkmeUi.getRecordRevision() }
 })
 const stopUi = arkmeUi.subscribe(() => {
  const next = arkmeUi.getRecordRevision()
  if (next === lastRecord) return
  lastRecord = next
  if (!receiving && account) void bridge.publish({kind:'changed'},account).catch(() => {})
 })
 const stopAuth = arkmeAuthStore.subscribe(changed); changed()
 return () => { generation++; stopDrafts?.(); stopAuth(); stopEvents(); stopUi() }
}
export async function withConversationSend(key: string | undefined, send: (consumed: () => Promise<void>) => Promise<void>): Promise<void> {
 const bridge = conversationWindowBridge()
 if (!bridge || !key) { await send(async () => {}); return }
 const account = conversationAccountKey()
 if (!account) throw new Error('请先登录')
 const token = crypto.randomUUID()
 await flushDrafts()
 if (account !== conversationAccountKey() || !await bridge.acquire(key,account,token)) return
 try {
  // Edits can arrive during acquire or snapshot. Flush them and only apply a
  // snapshot while both local drafts still have the identities it was read for.
  const articleKey = `${account}:${key}`
  while (true) {
   const draft = arkmeComposerDraftStore.get(key), article = composerArticleStore.get(articleKey)
   await flushDrafts()
   if (account !== conversationAccountKey()) return
   if (draft !== arkmeComposerDraftStore.get(key) || article !== composerArticleStore.get(articleKey)) continue
   const snapshot = await bridge.snapshot(account)
   if (account !== conversationAccountKey()) return
   if (draft !== arkmeComposerDraftStore.get(key) || article !== composerArticleStore.get(articleKey)) continue
   // Keep the broker's consumed-draft protection for stale secondary windows.
   for (const event of snapshot) {
    if (event.kind === 'draft' && event.key === key) arkmeComposerDraftStore.applyRemote(key,event.value)
    if (event.kind === 'article' && event.key === articleKey) composerArticleStore.applyRemote(event.key,event.value)
   }
   break
  }
  await send(async () => { await flushDrafts(); await bridge.consumed(key,account,token) })
  await flushDrafts()
  await bridge.publish({kind:'changed'},account)
 } finally { await bridge.release(key,account,token) }
}
