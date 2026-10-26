import type { ArkmeSourceItem, ArkmeTimelineItem } from '../types.js'
import { arkmeUi } from './ui-controller.js'
import { arkmeAuthStore } from './auth-store.js'
export interface LongArticleWindowTarget {
  accountKey: string
  sourceKey: string
  sourceRef: string
  displayName: string
  surface?: 'location' | 'library'
  location?: { initialDate?: import('./day-location-cache.js').LocationDateFilter; initialLocation?: import('../types.js').ArkmeRecordLocationObservation }
  autoPublish?: boolean
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
export function longArticleWindowBridge(): LongArticleWindowBridge | undefined {
  const bridge = (globalThis as typeof globalThis & { arkmeLongArticle?: LongArticleWindowBridge }).arkmeLongArticle
  return bridge?.version === 1 || bridge?.version === 2 || bridge?.version === 3 ? bridge : undefined
}
export function longArticleWindowRequested(): boolean {
  return typeof location !== 'undefined' && new URLSearchParams(location.search).get('arkmeLongArticle') === '1'
}
export function longArticleAccountKey(): string | null {
  const auth = arkmeAuthStore.getSnapshot().auth
  return auth?.status === 'authenticated' && auth.userId !== undefined ? `${auth.environment}:${auth.userId}` : null
}
export async function openLongArticleWindow(source: Pick<ArkmeSourceItem, 'sourceRef' | 'displayName'> & { sourceKey: string }, article?: LongArticleWindowTarget['article'], autoPublish = false): Promise<boolean> {
  const bridge = longArticleWindowBridge()
  if (!bridge || (article && bridge.version < 2) || (autoPublish && bridge.version < 3)) return false
  const accountKey = longArticleAccountKey()
  if (!accountKey) throw new Error('请先登录后再创建长文')
  if (longArticleWindowRequested()) {
    if (!await bridge.active()) throw new Error('账号已切换，请重试')
  } else await bridge.account(accountKey)
  if (longArticleAccountKey() !== accountKey) throw new Error('账号已切换，请重试')
  return await bridge.open({ accountKey, sourceRef: source.sourceRef, sourceKey: source.sourceKey, displayName: source.displayName, ...(article ? { article } : {}), ...(autoPublish ? { autoPublish: true } : {}) })
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
