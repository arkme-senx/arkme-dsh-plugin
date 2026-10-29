import type { ArkmeSourceItem, ArkmeTimelineItem } from '../types.js'
import { arkmeUi } from './ui-controller.js'
import { arkmeAuthStore } from './auth-store.js'
import type { TeamRepresentationSelection } from '../team-group-contract.js'
export interface LongArticleComposition { draftScope: string; representation: TeamRepresentationSelection }
export interface LongArticleWindowTarget {
  accountKey: string
  sourceKey: string
  sourceRef: string
  displayName: string
  surface?: 'location' | 'library'
  location?: { initialDate?: import('./day-location-cache.js').LocationDateFilter; initialLocation?: import('../types.js').ArkmeRecordLocationObservation }
  autoPublish?: boolean
  composition?: LongArticleComposition
  article?: { mode: 'existing' | 'snapshot'; item: ArkmeTimelineItem }
}
export interface LongArticleWindowReceipt extends LongArticleWindowTarget { item: ArkmeTimelineItem }
export interface LongArticleWindowBridge {
  version: 1 | 2 | 3
  navigate?(target: WindowNavigation): Promise<boolean>
  changed?(): Promise<boolean>
  onChanged?(listener: () => void): () => void
  onContextChanged?(listener: (target: LongArticleWindowTarget) => void): () => void
  onNavigate?(listener: (target: WindowNavigation & { accountKey: string }) => void): () => void
  open(target: LongArticleWindowTarget): Promise<boolean>
  account(account: string | null): Promise<boolean>
  context(): Promise<LongArticleWindowTarget | null>
  active(): Promise<boolean>
  close(): Promise<void>
  cancelClose(): Promise<void>
  published(item: ArkmeTimelineItem): Promise<boolean>
  onClose(listener: () => void): () => void
  onInvalidated(listener: () => void): () => void
  onCreated(listener: (value: LongArticleWindowReceipt) => void): () => void
}
// Native clients whitelist target fields. Its opaque window key is scoped by the
// stable team draft key; rotating transport refs must not open duplicate editors.
// The scoped source reference carries the frozen composition only across this
// bridge. It is decoded here before any UI or business request sees the target.
const compositionWindowKeyPrefix = 'arkme-article-composition-v1:'
const windowAdapters = new WeakMap<LongArticleWindowBridge, LongArticleWindowBridge>()
function readComposition(raw: unknown): LongArticleComposition {
  const invalid = () => new Error('长文发言身份上下文已失效，请从原会话重新打开；草稿已保留')
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw invalid()
  const value = raw as Record<string, unknown>, r = value.representation as Record<string, unknown> | undefined
  if (typeof value.draftScope !== 'string' || !value.draftScope.trim() || !r || typeof r !== 'object' || Array.isArray(r)
    || typeof r.teamRef !== 'string' || !r.teamRef.trim() || !['owner', 'member'].includes(String(r.membershipKind))
    || !Number.isSafeInteger(r.membershipRevision) || Number(r.membershipRevision) < 0
    || r.membershipKind === 'owner' && r.membershipRevision !== 0
    || !Number.isSafeInteger(r.groupJoinAt) || Number(r.groupJoinAt) < 0) throw invalid()
  return { draftScope: value.draftScope, representation: {
    teamRef: r.teamRef, membershipKind: r.membershipKind as 'owner' | 'member',
    membershipRevision: Number(r.membershipRevision), groupJoinAt: Number(r.groupJoinAt),
  } }
}
function nativeWindowTarget(target: LongArticleWindowTarget): LongArticleWindowTarget {
  if (!target.composition) return target
  const { composition: raw, ...native } = target, composition = readComposition(raw)
  const sourceKey = compositionWindowKeyPrefix + JSON.stringify([target.sourceKey, composition.draftScope])
  const sourceRef = compositionWindowKeyPrefix + JSON.stringify([target.sourceRef, composition])
  if (sourceKey.length > 16_384 || sourceRef.length > 16_384) throw new Error('长文发言身份上下文过长，请重新打开；草稿已保留')
  return { ...native, sourceKey, sourceRef }
}
function pluginWindowTarget(target: LongArticleWindowTarget): LongArticleWindowTarget {
  if (!target.sourceKey.startsWith(compositionWindowKeyPrefix) && !target.sourceRef.startsWith(compositionWindowKeyPrefix)) return target
  const readPair = (wire: string): [string, unknown] => {
    if (!wire.startsWith(compositionWindowKeyPrefix)) throw new Error('长文窗口上下文已失效')
    const raw: unknown = JSON.parse(wire.slice(compositionWindowKeyPrefix.length))
    if (!Array.isArray(raw) || raw.length !== 2 || typeof raw[0] !== 'string' || !raw[0]) throw new Error('长文窗口上下文已失效')
    return [raw[0], raw[1]]
  }
  const key = readPair(target.sourceKey), ref = readPair(target.sourceRef), composition = readComposition(ref[1])
  if (key[1] !== composition.draftScope) throw new Error('长文窗口身份与草稿不一致')
  return { ...target, sourceKey: key[0], sourceRef: ref[0], composition }
}
export function longArticleWindowBridge(): LongArticleWindowBridge | undefined {
  const bridge = (globalThis as typeof globalThis & { arkmeLongArticle?: LongArticleWindowBridge }).arkmeLongArticle
  if (!bridge || ![1, 2, 3].includes(bridge.version)) return undefined
  const known = windowAdapters.get(bridge)
  if (known) return known
  const adapter: LongArticleWindowBridge = {
    ...bridge,
    open: target => bridge.open(nativeWindowTarget(target)),
    context: async () => { const target = await bridge.context(); return target && pluginWindowTarget(target) },
    onCreated: listener => bridge.onCreated(receipt => {
      let target: LongArticleWindowTarget
      try { target = pluginWindowTarget(receipt) } catch { return }
      listener({ ...target, item: receipt.item })
    }),
    ...(bridge.onContextChanged ? { onContextChanged: (listener: (target: LongArticleWindowTarget) => void) => bridge.onContextChanged!(raw => {
      let target: LongArticleWindowTarget
      try { target = pluginWindowTarget(raw) } catch { return }
      listener(target)
    }) } : {}),
  }
  windowAdapters.set(bridge, adapter)
  return adapter
}
export function longArticleWindowRequested(): boolean {
  return typeof location !== 'undefined' && new URLSearchParams(location.search).get('arkmeLongArticle') === '1'
}
export function longArticleAccountKey(): string | null {
  const auth = arkmeAuthStore.getSnapshot().auth
  return auth?.status === 'authenticated' && auth.userId !== undefined ? `${auth.environment}:${auth.userId}` : null
}
export async function openLongArticleWindow(source: Pick<ArkmeSourceItem, 'sourceRef' | 'displayName'> & { sourceKey: string }, article?: LongArticleWindowTarget['article'], autoPublish = false, composition?: LongArticleComposition): Promise<boolean> {
  const bridge = longArticleWindowBridge()
  if (!bridge || (article && bridge.version < 2) || (autoPublish && bridge.version < 3)) return false
  const accountKey = longArticleAccountKey()
  if (!accountKey) throw new Error('请先登录后再创建长文')
  if (longArticleWindowRequested()) {
    if (!await bridge.active()) throw new Error('账号已切换，请重试')
  } else await bridge.account(accountKey)
  if (longArticleAccountKey() !== accountKey) throw new Error('账号已切换，请重试')
  return await bridge.open({ accountKey, sourceRef: source.sourceRef, sourceKey: source.sourceKey, displayName: source.displayName, ...(article ? { article } : {}), ...(autoPublish ? { autoPublish: true } : {}), ...(composition ? { composition } : {}) })
}
export function bindLongArticleWindowAccount(): () => void {
  const bridge = longArticleWindowBridge()
  if (!bridge) return () => {}
  const sync = () => { void bridge.account(longArticleAccountKey()).catch(() => {}) }
  sync()
  const stopAccount = arkmeAuthStore.subscribe(sync)
  const stopNavigate = bridge.onNavigate?.(target => {
    if (longArticleAccountKey() !== target.accountKey) return
    arkmeUi.showConversationTarget(target.source, target.recordUid, target.sendAtMillis, target.recordOwnerUserId)
  })
  const stopChanged = bridge.onChanged?.(() => arkmeUi.recordChanged())
  return () => { stopAccount(); stopNavigate?.(); stopChanged?.() }
}

export interface WindowNavigation {
  source: ArkmeSourceItem
  recordUid: string
  sendAtMillis: number
  recordOwnerUserId?: number | string
}
export async function openBrowseWindow(surface: 'location' | 'library', location?: LongArticleWindowTarget['location']): Promise<boolean> {
  const bridge = longArticleWindowBridge()
  if (!bridge || bridge.version < 3) return false
  const accountKey = longArticleAccountKey()
  if (!accountKey) throw new Error('请先登录')
  if (longArticleWindowRequested()) {
    if (!await bridge.active()) throw new Error('账号已切换，请重试')
  } else await bridge.account(accountKey)
  if (longArticleAccountKey() !== accountKey) throw new Error('账号已切换，请重试')
  return bridge.open({ accountKey, sourceKey: `browse:${surface}`, sourceRef: `browse:${surface}`,
    displayName: surface === 'location' ? '位置' : '长文', surface, ...(location ? { location } : {}) })
}
