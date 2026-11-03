import type { IdentityShareCard } from '../identity-share-contract.js'
import { identityShareTarget } from '../identity-share-link.js'
import { callArkme } from './api.js'
import { arkmeAuthStore } from './auth-store.js'
import { identityShareAccountScope } from './identity-share-ui.js'

type PersonCard = Extract<IdentityShareCard, { kind: 'person' }>
type Entry = { card: PersonCard; readAt: number }
type Job = { controller: AbortController; users: number; promise: Promise<PersonCard> }
const FRESH_MS = 60_000, RETAIN_MS = 10 * 60_000, MAX_CARDS = 64, MAX_JOBS = 48

/** Visible link previews and open cards share one account-bound read and snapshot. */
export class IdentityPersonCardClient {
  private scope = ''
  private cache = new Map<string, Entry>()
  private jobs = new Map<string, Job>()
  private listeners = new Set<() => void>()
  constructor(private readonly read = (scope: string, url: string, signal: AbortSignal) => callArkme<PersonCard>('identity.share.read', { accountScope: scope, url }, signal),
    private readonly now = () => Date.now()) {}
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener) } }
  private emit() { this.listeners.forEach(listener => listener()) }
  private key(scope: string, url: string): string | undefined {
    const target = identityShareTarget(url)
    return target?.kind === 'world' && scope.startsWith(`${target.environment}:`) ? `${scope}:${target.id}` : undefined
  }
  setScope(scope: string) {
    if (this.scope === scope) return
    this.scope = scope
    for (const job of this.jobs.values()) job.controller.abort()
    this.jobs.clear(); this.cache.clear(); this.emit()
  }
  snapshot(scope: string, url: string): Entry | undefined {
    if (scope !== this.scope) return
    const key = this.key(scope, url), entry = key ? this.cache.get(key) : undefined
    return entry && this.now() - entry.readAt <= RETAIN_MS ? entry : undefined
  }
  invalidate(scope: string, url: string) {
    const key = this.key(scope, url)
    if (scope !== this.scope || !key) return
    const job = this.jobs.get(key)
    if (job) { job.controller.abort(); this.jobs.delete(key) }
    if (this.cache.delete(key)) this.emit()
  }
  acquire(scope: string, url: string, force = false): { promise: Promise<PersonCard>; release(): void } {
    const key = this.key(scope, url)
    if (!scope || scope !== this.scope || !key) return { promise: Promise.reject(new Error('账号或名片链接已变化，请重新打开')), release() {} }
    const cached = this.cache.get(key)
    if (!force && cached && this.now() - cached.readAt < FRESH_MS) return { promise: Promise.resolve(cached.card), release() {} }
    let job = this.jobs.get(key)
    if (!job) {
      if (this.jobs.size >= MAX_JOBS) return { promise: Promise.reject(new Error('名片正在读取，请稍后重试')), release() {} }
      const controller = new AbortController()
      job = { controller, users: 0, promise: undefined! }
      const current = job
      current.promise = Promise.resolve().then(() => { controller.signal.throwIfAborted(); return this.read(scope, url, controller.signal) }).then(card => {
        controller.signal.throwIfAborted()
        if (scope !== this.scope) throw new Error('账号已切换，请重新打开名片')
        if (card.kind !== 'person' || !Number.isSafeInteger(card.userId) || card.userId <= 0
          || this.key(scope, card.url) !== key || this.key(scope, `https://${scope.startsWith('prod:') ? 'jiwo.cc' : 'jotmo-app.senguo.me'}/${card.accountName}`) !== key) throw new Error('联系人资料响应不一致，请刷新重试')
        this.cache.delete(key); this.cache.set(key, { card, readAt: this.now() })
        while (this.cache.size > MAX_CARDS) this.cache.delete(this.cache.keys().next().value!)
        this.emit(); return card
      }).catch(error => {
        // A definitive unavailable/changed identity cannot keep an actionable stale card.
        if (!controller.signal.aborted && scope === this.scope && ['identity-share-person-unavailable', 'identity-share-person-changed', 'identity-share-environment-mismatch'].includes(error?.body?.code ?? error?.code)) this.invalidate(scope, url)
        throw error
      }).finally(() => { if (this.jobs.get(key) === current) this.jobs.delete(key) })
      this.jobs.set(key, current)
    }
    job.users++
    const current = job
    let released = false
    return { promise: current.promise, release: () => {
      if (released) return
      released = true
      if (--current.users > 0 || this.jobs.get(key) !== current) return
      current.controller.abort(); this.jobs.delete(key)
    } }
  }
}
export const identityPersonCards = new IdentityPersonCardClient()
identityPersonCards.setScope(identityShareAccountScope())
arkmeAuthStore.subscribe(() => identityPersonCards.setScope(identityShareAccountScope()))
