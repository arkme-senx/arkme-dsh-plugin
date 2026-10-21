import { arkmeChatDirectory } from './chat-directory-store.js'
import { composerArticleStore, type ComposerArticleStore } from './composer-article-store.js'
import { outgoingCallUi } from './outgoing-call-ui-controller.js'
import { arkmeComposerDraftStore, type ArkmeComposerDraftStore } from './composer-draft-store.js'
import { arkmeAuthStore } from './auth-store.js'
import { arkmeUi } from './ui-controller.js'
import { conversationAccountKey, conversationWindowBridge, conversationWindowRequested, type ConversationWindowBridge } from './conversation-window.js'
import { arkmeRecentEmojiStore } from './emoji-recent-store.js'
import { LocalAutosave } from './local-autosave.js'
const retiredSaves = new Set<LocalAutosave<{kind: 'draft' | 'article'; value: unknown}>>()
const draftSaves = new Set<LocalAutosave<{kind: 'draft' | 'article'; value: unknown}>>()
export async function flushConversationDrafts(): Promise<void> { await flushDrafts(undefined, true) }
async function flushDrafts(keys?: ReadonlySet<string>, retry = false): Promise<void> {
 await Promise.all([...draftSaves].map(async save => {
  await save.flush(keys, retry)
  if (!keys && retiredSaves.delete(save)) draftSaves.delete(save)
 }))
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
export async function connectConversationDrafts(bridge: ConversationWindowBridge, store: ArkmeComposerDraftStore, userId: number, accountKey: string, articles: ComposerArticleStore = composerArticleStore, signal?: AbortSignal): Promise<() => void> {
 const prefix = `arkme-composer:${userId}:`
 let applying = false, stopped = false
 const hydrated = new Set<string>()
 let previous = new Map(store.entries())
 const saves = new LocalAutosave<{kind: 'draft' | 'article'; value: unknown}>(async (key, {kind, value}) => {
  if (await bridge.publish({kind,key,value},accountKey) === false) throw new Error('草稿保存未确认')
  if (kind === 'draft') store.confirmNativeSave(key); else articles.confirmNativeSave(key)
 })
 if (bridge.draftPersistence === 1) { store.useNativePersistence(); articles.useNativePersistence(`${accountKey}:${prefix}`) }
 const revisions = new Map<string, number>()
 let previousArticles = articles.entries()
 const articlePrefix = `${accountKey}:${prefix}`
 const editedDuringBoot = new Set<string>()
 const stopBootEdits = store.subscribe((key, reason) => { if (applying || reason === 'evict') return; if (key === undefined) for (const key of new Set([...previous.keys(), ...store.entries().keys()])) editedDuringBoot.add(key); else editedDuringBoot.add(key) })
 const stopBootArticles = articles.subscribe(() => { if (applying) return; const next = articles.entries(); for (const key of new Set([...previousArticles.keys(), ...next.keys()])) if (previousArticles.get(key) !== next.get(key)) editedDuringBoot.add(key) })
 const apply = (event: Awaited<ReturnType<ConversationWindowBridge['snapshot']>>[number]) => {
  if (stopped || signal?.aborted || (event.accountKey !== undefined && event.accountKey !== accountKey)) return
  if ('key' in event && event.revision !== undefined) {
   if (event.revision <= (revisions.get(event.key) ?? -1)) return
   revisions.set(event.key, event.revision)
  }
  if (event.kind === 'busy') { notifyBusy(event.key,event.value); return }
  if (event.kind === 'article' && event.key.startsWith(articlePrefix)) {
    hydrated.add(event.key)
    if (saves.hasUnpublished(event.key) || editedDuringBoot.has(event.key)) return
    applying = true; try { articles.applyRemote(event.key,event.value, event.restored === true); previousArticles = articles.entries() } finally { applying = false }; return
  }
  if (event.kind !== 'draft' || !event.key.startsWith(prefix)) return
  hydrated.add(event.key)
  // A received snapshot predates local edits that have not reached the broker yet.
  if (saves.hasUnpublished(event.key) || editedDuringBoot.has(event.key)) return
  applying = true
  try { store.applyRemote(event.key,event.value); previous = new Map(store.entries()) } finally { applying = false }
 }
 let booting = true
 const buffered: Parameters<typeof apply>[0][] = []
 const stopEvents = bridge.onEvent(event => { if (booting) buffered.push(event); else apply(event) })
 try { for (const event of await bridge.snapshot(accountKey)) apply(event); for (const event of buffered) apply(event); booting = false } catch (error) { stopEvents(); throw error } finally { stopBootEdits(); stopBootArticles() }
 if (signal?.aborted) return () => {}
 draftSaves.add(saves)
 const publish = (key: string, value: unknown, kind: 'draft' | 'article' = 'draft') => saves.save(key,{kind,value},true)
 for (const key of new Set([...store.entries().keys(), ...editedDuringBoot])) if (key.startsWith(prefix) && (!hydrated.has(key) || editedDuringBoot.has(key))) publish(key,store.entries().get(key) ?? null)
 for (const key of new Set([...articles.entries().keys(), ...editedDuringBoot])) if (key.startsWith(articlePrefix) && (!hydrated.has(key) || editedDuringBoot.has(key))) publish(key,articles.entries().get(key) ?? null,'article')
 editedDuringBoot.clear()
 const stopArticles = articles.subscribe(() => {
  if (applying || stopped) return
  const next = articles.entries()
  for (const key of new Set([...previousArticles.keys(),...next.keys()])) if (key.startsWith(articlePrefix) && previousArticles.get(key) !== next.get(key)) publish(key,next.get(key) ?? null,'article')
  previousArticles = next
 })
 const flush = () => { void saves.flush().catch(() => {}) }
 if (typeof window !== 'undefined') window.addEventListener('pagehide', flush)
 const stopStore = store.subscribe((changedKey, reason) => {
  if (applying || stopped || reason === 'evict') return
  const next = changedKey === undefined ? store.entries() : undefined
  const keys = changedKey === undefined ? new Set([...previous.keys(), ...next!.keys()]) : [changedKey]
  for (const key of keys) {
   if (!key.startsWith(prefix)) continue
   const draft = store.get(key)
   const value = draft.text === '' && draft.attachments.length === 0 && draft.markdown === undefined && draft.extensionTarget === undefined ? null : draft
   // Object URLs belong to their creating page; receivers resolve previews from the asset/file reference.
   saves.save(key, {kind:'draft', value: value ? {...value, attachments: value.attachments.map(({previewUrl: _preview, ...item}) => item)} : null})
   if (value === null) previous.delete(key); else previous.set(key, value)
  }
  if (next !== undefined) previous = new Map(next)
 })

 return () => {
  stopped = true; stopEvents(); stopStore(); stopArticles()
  if (typeof window !== 'undefined') window.removeEventListener('pagehide', flush)
  // Retain an unsaved connection in the exit barrier; never discard a failed final save.
  retiredSaves.add(saves)
  void saves.flush().then(() => { draftSaves.delete(saves); retiredSaves.delete(saves) }, () => {})
  busy.clear(); revision++; for (const listener of listeners) listener()
 }
}
export function bindConversationWindows(): () => void {
 const bridge = conversationWindowBridge(); if (!bridge) return () => {}
 let generation = 0, account: string | null | undefined, stopDrafts: (() => void) | undefined
 let controller: AbortController | undefined
 let connecting: Promise<void> = Promise.resolve(), connectionError: unknown
 const stopFlush = bridge.onFlush?.(async () => { await connecting; if (connectionError) throw connectionError; await Promise.all([flushConversationDrafts(), account ? arkmeRecentEmojiStore.flush(account) : Promise.resolve()]) })
 const changed = () => {
  const next = conversationAccountKey(); if (next === account) return
  account = next; const run = ++generation; controller?.abort(); controller = new AbortController(); const signal = controller.signal; stopDrafts?.(); stopDrafts = undefined
  connectionError = undefined
  connecting = (async () => {
   if (!conversationWindowRequested()) await bridge.account(next)
   const userId = arkmeAuthStore.getSnapshot().auth?.userId
   if (run !== generation || !next || userId === undefined) return
   const stop = await connectConversationDrafts(bridge,arkmeComposerDraftStore,userId,next,composerArticleStore,signal)
   if (run === generation) stopDrafts = stop; else stop()
  })().catch(error => { if (run === generation) connectionError = error })
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
 return () => { generation++; controller?.abort(); stopDrafts?.(); stopFlush?.(); stopAuth(); stopEvents(); stopUi() }
}
export async function withConversationSend(key: string | undefined, send: (consumed: () => Promise<void>) => Promise<void>): Promise<void> {
 const bridge = conversationWindowBridge()
 if (!bridge || !key) { await send(async () => {}); return }
 const account = conversationAccountKey()
 if (!account) throw new Error('请先登录')
 const token = crypto.randomUUID()
 const keys = new Set([key, `${account}:${key}`])
 await flushDrafts(keys, true)
 if (account !== conversationAccountKey() || !await bridge.acquire(key,account,token)) return
 try {
  // Edits can arrive during acquire or snapshot. Flush them and only apply a
  // snapshot while both local drafts still have the identities it was read for.
  const articleKey = `${account}:${key}`
  while (true) {
   const draft = arkmeComposerDraftStore.get(key), article = composerArticleStore.get(articleKey)
   await flushDrafts(keys)
   if (account !== conversationAccountKey()) return
   if (draft !== arkmeComposerDraftStore.get(key) || article !== composerArticleStore.get(articleKey)) continue
   const snapshot = await bridge.snapshot(account)
   if (account !== conversationAccountKey()) return
   if (draft !== arkmeComposerDraftStore.get(key) || article !== composerArticleStore.get(articleKey)) continue
   // Keep the broker's consumed-draft protection for stale secondary windows.
   for (const event of snapshot) {
    if (event.kind === 'draft' && event.key === key) arkmeComposerDraftStore.applyRemote(key,event.value)
    if (event.kind === 'article' && event.key === articleKey) composerArticleStore.applyRemote(event.key,event.value,event.restored === true)
   }
   break
  }
  await send(async () => { await flushDrafts(keys); await bridge.consumed(key,account,token) })
  await flushDrafts(keys)
  await bridge.publish({kind:'changed'},account)
 } finally { await bridge.release(key,account,token) }
}
