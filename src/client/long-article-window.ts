import type { ArkmeSourceItem, ArkmeTimelineItem } from '../types.js'
import { arkmeAuthStore } from './auth-store.js'
export interface LongArticleWindowTarget {
  accountKey: string
  sourceKey: string
  sourceRef: string
  displayName: string
  article?: { mode: 'existing' | 'snapshot'; item: ArkmeTimelineItem }
}
export interface LongArticleWindowReceipt extends LongArticleWindowTarget { item: ArkmeTimelineItem }
export interface LongArticleWindowBridge {
  version: 1 | 2
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
  return bridge?.version === 1 || bridge?.version === 2 ? bridge : undefined
}
export function longArticleWindowRequested(): boolean {
  return typeof location !== 'undefined' && new URLSearchParams(location.search).get('arkmeLongArticle') === '1'
}
export function longArticleAccountKey(): string | null {
  const auth = arkmeAuthStore.getSnapshot().auth
  return auth?.status === 'authenticated' && auth.userId !== undefined ? `${auth.environment}:${auth.userId}` : null
}
export async function openLongArticleWindow(source: Pick<ArkmeSourceItem, 'sourceRef' | 'displayName'> & { sourceKey: string }, article?: LongArticleWindowTarget['article']): Promise<boolean> {
  const bridge = longArticleWindowBridge()
  if (!bridge || (article && bridge.version < 2)) return false
  const accountKey = longArticleAccountKey()
  if (!accountKey) throw new Error('请先登录后再创建长文')
  await bridge.account(accountKey)
  if (longArticleAccountKey() !== accountKey) throw new Error('账号已切换，请重试')
  return await bridge.open({ accountKey, sourceRef: source.sourceRef, sourceKey: source.sourceKey, displayName: source.displayName, ...(article ? { article } : {}) })
}
export function bindLongArticleWindowAccount(): () => void {
  const bridge = longArticleWindowBridge()
  if (!bridge) return () => {}
  const sync = () => { void bridge.account(longArticleAccountKey()).catch(() => {}) }
  sync()
  return arkmeAuthStore.subscribe(sync)
}
