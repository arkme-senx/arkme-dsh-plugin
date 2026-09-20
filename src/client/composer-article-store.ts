import { useSyncExternalStore } from 'react'
import type { ArkmeLongArticleDetail, ArkmeLongArticleDraft, ArkmeSourceSendResult } from '../types.js'
import { callArkme } from './api.js'
import { arkmeAuthStore } from './auth-store.js'

export type ComposerArticle =
  | { kind: 'existing'; detail: ArkmeLongArticleDetail; messageActionRef: string }
  | { kind: 'new'; draft: ArkmeLongArticleDraft & { recordUid: string; relationUid: string } }
export interface ComposerArticleState {
  article: ComposerArticle
  recordUid: string
  relationUid: string
  sendAtMillis: number
  sending: boolean
  error: string
}
const storagePrefix = 'arkme.composer.article.v1:'
function validArticle(article: ComposerArticle | undefined): article is ComposerArticle {
  if (article?.kind === 'existing') return typeof article.detail?.sourceRef === 'string' && typeof article.detail.title === 'string'
    && typeof article.detail.textContent === 'string' && typeof article.messageActionRef === 'string'
  if (article?.kind === 'new') return typeof article.draft?.sourceRef === 'string' && typeof article.draft.title === 'string'
    && typeof article.draft.textContent === 'string' && typeof article.draft.recordUid === 'string' && typeof article.draft.relationUid === 'string'
  return false
}

/** Independent from the text/files draft: article sends must never consume that draft. */
export class ComposerArticleStore {
  private states = new Map<string, ComposerArticleState>()
  private listeners = new Set<() => void>()
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener) } }
  get = (key?: string): ComposerArticleState | undefined => {
    if (!key) return undefined
    if (!this.states.has(key)) {
      try {
        const saved = JSON.parse(localStorage.getItem(storagePrefix + key) || 'null') as ComposerArticleState | null
        if (saved && validArticle(saved.article) && typeof saved.recordUid === 'string'
          && typeof saved.relationUid === 'string' && Number.isSafeInteger(saved.sendAtMillis) && saved.sendAtMillis > 0) {
          this.states.set(key, { ...saved, sending: false, error: saved.sending ? '上次发送结果待确认，可重试；将使用同一提交标识' : saved.error })
        }
      } catch { /* An unavailable browser store must not prevent composing. */ }
    }
    return this.states.get(key)
  }
  entries(): ReadonlyMap<string, ComposerArticleState> { return new Map(this.states) }
  applyRemote(key: string, value: unknown): void {
    if (value === null) { this.write(key, undefined); return }
    const state = value as ComposerArticleState | undefined
    if (!state || !validArticle(state.article) || typeof state.recordUid !== 'string'
      || typeof state.relationUid !== 'string' || typeof state.sending !== 'boolean') return
    this.write(key, state)
  }
  set(key: string, article: ComposerArticle): void {
    if (this.get(key)?.sending) return
    this.write(key, { article, recordUid: article.kind === 'new' ? article.draft.recordUid : crypto.randomUUID(),
      relationUid: article.kind === 'new' ? article.draft.relationUid : crypto.randomUUID(), sendAtMillis: Date.now(), sending: false, error: '' })
  }
  remove(key: string): void { if (!this.get(key)?.sending) this.write(key, undefined) }
  async send(key: string, sourceRef: string, expectedUserId: number, expectedEnvironment: string, consumed?: () => Promise<void>): Promise<ArkmeSourceSendResult | undefined> {
    const state = this.get(key)
    const sameAccount = () => { const auth = arkmeAuthStore.getSnapshot().auth; return auth?.status === 'authenticated' && auth.userId === expectedUserId && auth.environment === expectedEnvironment }
    if (!state || state.sending || !sameAccount()) return undefined
    const sending = { ...state, sending: true, error: '' }
    this.write(key, sending)
    try {
      if (consumed) await consumed()
      const article = state.article
      const result = article.kind === 'existing'
        ? await callArkme<ArkmeSourceSendResult>('source.forward-messages', {
          sourceRef: article.detail.sourceRef, actionRefs: [article.messageActionRef], targetSourceRef: sourceRef,
          expectedUserId, recordUid: state.recordUid, relationUid: state.relationUid, sendAtMillis: state.sendAtMillis,
        })
        : await callArkme<ArkmeSourceSendResult>('source.long-article.publish', {
          sourceRef, expectedUserId, recordUid: state.recordUid, relationUid: state.relationUid,
          title: article.draft.title, textContent: article.draft.textContent, textFormat: article.draft.textFormat,
          images: article.draft.images, recordDurationMillis: article.draft.durationMillis,
        })
      if (this.ownsSubmission(key, sending)) this.write(key, undefined)
      // Delete only the matching local editor draft, not a newer article opened elsewhere.
      if (article.kind === 'new' && sameAccount()) {
        await callArkme('source.long-article.draft.delete', { sourceRef, expectedRecordUid: state.recordUid }).catch(() => {})
      }
      return sameAccount() ? result : undefined
    } catch (error) {
      if (this.ownsSubmission(key, sending)) this.write(key, { ...state, sending: false, error: error instanceof Error ? error.message : '长文发送失败，请重试' })
      return undefined
    }
  }
  private ownsSubmission(key: string, state: ComposerArticleState): boolean {
    const current = this.states.get(key)
    // Replication clones objects. Submission identity survives renderer boundaries.
    return current?.sending === true && current.recordUid === state.recordUid && current.relationUid === state.relationUid
  }
  private write(key: string, state: ComposerArticleState | undefined): void {
    if (state) this.states.set(key, state); else this.states.delete(key)
    try { if (state) localStorage.setItem(storagePrefix + key, JSON.stringify(state)); else localStorage.removeItem(storagePrefix + key) } catch { /* Best effort local recovery. */ }
    for (const listener of this.listeners) listener()
  }
}
export const composerArticleStore = new ComposerArticleStore()
export function useComposerArticle(key?: string) {
  return useSyncExternalStore(composerArticleStore.subscribe, () => composerArticleStore.get(key), () => undefined)
}
export function composerArticleKey(accountKey?: string, draftKey?: string): string | undefined { return accountKey && draftKey ? `${accountKey}:${draftKey}` : undefined }
