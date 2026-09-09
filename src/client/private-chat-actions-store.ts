import type { ArkmeDirectMessageAdmission } from '../direct-message-admission.js'
import type { ArkmeSourceItem, ArkmeUserBanRecord, ArkmeUserBanSnapshot, ArkmeUserProfileSnapshot } from '../types.js'
import { ArkmeClientError, callArkme } from './api.js'
import { ResourceStore, resourceCancelled } from './resource-store.js'
import { shouldShowUserBanAction } from './user-ban.js'

export interface ChatActionBinding {
  account: string
  source: Pick<ArkmeSourceItem, 'sourceRef' | 'sourceKey' | 'kind' | 'peerUserId' | 'displayName'>
}
export interface IdentityBinding { account: string; userId: number }
export const chatActionKey = (binding: ChatActionBinding): string => `${binding.account}:${binding.source.sourceKey || binding.source.sourceRef}`

/** Business ports retain their separate authorities: Auth, Chat, and Backend. */
export interface PrivateChatActionsPort {
  identity(binding: IdentityBinding, signal: AbortSignal): Promise<ArkmeUserProfileSnapshot>
  eligibility(binding: ChatActionBinding, signal: AbortSignal): Promise<{ allowed: boolean }>
  admission(binding: ChatActionBinding, signal: AbortSignal): Promise<ArkmeDirectMessageAdmission>
  setRefused(binding: ChatActionBinding, refused: boolean, revision: number, signal: AbortSignal): Promise<ArkmeDirectMessageAdmission>
  banStatus(binding: ChatActionBinding, signal: AbortSignal): Promise<ArkmeUserBanSnapshot>
  setBanned(binding: ChatActionBinding, banned: boolean, signal: AbortSignal): Promise<ArkmeUserBanRecord>
}

function storageKey(binding: ChatActionBinding): string {
  // Preserve the installed storage contract; stable sourceKey is the in-memory identity, not a second disk format.
  return `arkme.direct-message-admission.v1:${binding.account}:${binding.source.sourceRef}`
}
function restoreAdmission(binding: ChatActionBinding): ArkmeDirectMessageAdmission | undefined {
  const raw = typeof window === 'undefined' ? null : window.localStorage?.getItem(storageKey(binding))
  if (raw == null) return undefined
  const value = JSON.parse(raw) as ArkmeDirectMessageAdmission
  if (typeof value.ownRefused !== 'boolean' || typeof value.counterpartRefused !== 'boolean'
    || typeof value.refusalCreationEnabled !== 'boolean' || typeof value.canSend !== 'boolean'
    || !Number.isSafeInteger(value.ownRevision) || value.ownRevision < 0
    || !Number.isSafeInteger(value.counterpartRevision) || value.counterpartRevision < 0
    || (value.ownRefused && value.ownRevision === 0) || (value.counterpartRefused && value.counterpartRevision === 0)) return undefined
  const state = value.ownRefused ? value.counterpartRefused ? 'mutually_refused' : 'refused_by_self'
    : value.counterpartRefused ? 'refused_by_counterpart' : 'allowed'
  return value.state === state && value.canSend === (state === 'allowed') ? value : undefined
}

/** A read-back cannot prove all side effects of a submitted command completed. Keep its explicit retry intent. */
export class UnconfirmedBanError extends Error {
  constructor(readonly banned: boolean, cause: unknown) {
    super(`${banned ? '封禁' : '解封'}结果尚未确认，请重试同一操作`, { cause })
  }
}

export function banAuthorizationRejected(error: unknown): boolean {
  // Backend intentionally uses InvalidParam for non-staff/abnormal accounts as well as bad targets.
  return error instanceof ArkmeClientError && ['arkme-code-1000', 'arkme-code-1001',
    'auth-http-401', 'auth-http-403', 'login-required', 'login-context-changed', 'login-expired', 'account-unavailable'].includes(error.body.code)
}

function definitelyRejectedBan(error: unknown): boolean {
  return banAuthorizationRejected(error) || error instanceof ArkmeClientError
    && ['arkme-request-queue-full', 'user-ban-remark-invalid', 'user-ban-private-chat-required', 'user-ban-peer-invalid', 'origin-required'].includes(error.body.code)
}

export class PrivateChatActionsStore {
  account: string | undefined
  readonly identity: ResourceStore<ArkmeUserProfileSnapshot, IdentityBinding>
  readonly eligibility: ResourceStore<{ allowed: boolean }, ChatActionBinding>
  readonly admission: ResourceStore<ArkmeDirectMessageAdmission, ChatActionBinding>
  readonly ban: ResourceStore<ArkmeUserBanSnapshot, ChatActionBinding>

  constructor(private readonly port: PrivateChatActionsPort) {
    this.identity = new ResourceStore({ freshForMs: 60_000, load: async (binding, signal) => {
      const result = await this.read(binding, signal, () => port.identity(binding, signal))
      if (result?.profile?.userId !== binding.userId) throw new Error('当前账号身份尚未确认')
      return result
    } })
    this.eligibility = new ResourceStore({ load: (binding, signal) => this.read(binding, signal, () => port.eligibility(binding, signal)) })
    this.admission = new ResourceStore({ load: (binding, signal) => this.read(binding, signal, () => port.admission(binding, signal)),
      accept: (current, next) => next.ownRevision >= current.ownRevision && next.counterpartRevision >= current.counterpartRevision,
      restore: restoreAdmission,
      persist: (binding, value) => { if (typeof window !== 'undefined') window.localStorage?.setItem(storageKey(binding), JSON.stringify(value)) },
    })
    this.ban = new ResourceStore({ load: (binding, signal) => {
      const userId = this.identity.get(binding.account).value?.profile?.userId
      if (userId === undefined || !this.canManage(binding, { account: binding.account, userId })) return Promise.reject(resourceCancelled())
      return this.read(binding, signal, () => port.banStatus(binding, signal))
    } })
  }

  private async read<T>(binding: { account: string }, signal: AbortSignal, load: () => Promise<T>): Promise<T> {
    if (this.account !== binding.account || signal.aborted) throw resourceCancelled()
    const result = await load()
    if (this.account !== binding.account || signal.aborted) throw resourceCancelled()
    return result
  }

  activateAccount(account: string | undefined): void {
    if (this.account === account) return
    const previous = this.account
    this.account = account
    if (previous !== undefined) {
      const matches = (key: string) => key === previous || key.startsWith(`${previous}:`)
      this.identity.reset(matches); this.eligibility.reset(matches); this.admission.reset(matches); this.ban.reset(matches)
    }
  }
  reset(): void {
    this.identity.reset(); this.eligibility.reset(); this.admission.reset(); this.ban.reset()
    this.identity.invalidate(); this.eligibility.invalidate(); this.admission.invalidate(); this.ban.invalidate()
  }

  canManage(binding: ChatActionBinding, identity: IdentityBinding): boolean {
    const current = this.identity.get(identity.account)
    return this.account === binding.account && binding.account === identity.account && !current.stale
      && current.value?.profile?.userId === identity.userId
      && Date.now() - current.updatedAt < 60_000
      && shouldShowUserBanAction({ authenticated: true, sourceKind: binding.source.kind,
        accountType: current.value?.profile?.accountType, peerUserId: binding.source.peerUserId, currentUserId: identity.userId })
  }

  async setRefused(binding: ChatActionBinding, refused: boolean, confirm: () => boolean, active: () => boolean): Promise<void> {
    if (this.account !== binding.account || !active()) return
    await this.admission.mutate(chatActionKey(binding), binding, async context => {
      let attempted = false
      try {
        const admission = context.value() ?? await context.read()
        if (!context.current() || !active()) throw resourceCancelled()
        if (admission.ownRefused === refused) { context.commit(admission); return }
        if (refused && (!admission.refusalCreationEnabled || !confirm())) return
        if (!context.current() || !active()) throw resourceCancelled()
        attempted = true
        context.commit(await this.port.setRefused(binding, refused, admission.ownRevision, context.signal))
      } catch (error) {
        const latest = error instanceof ArkmeClientError ? error.body?.directMessageAdmission : undefined
        if (latest !== undefined && context.current()) context.commit(latest)
        throw error
      } finally { if (attempted) context.invalidate() }
    })
  }

  async setBanned(binding: ChatActionBinding, identity: IdentityBinding, banned: boolean,
    confirm: (name: string, banned: boolean) => boolean, active: () => boolean): Promise<boolean> {
    if (this.account !== binding.account || !active()) return false
    return await this.ban.mutate(chatActionKey(binding), binding, async context => {
      await this.identity.refresh(identity.account, identity, false)
      if (!context.current() || !active()) throw resourceCancelled()
      if (!this.canManage(binding, identity)) throw new Error('当前账号无权管理用户封禁')
      if (!confirm(binding.source.displayName, banned)) return false
      if (!context.current() || !active()) throw resourceCancelled()
      try {
        const record = await this.port.setBanned(binding, banned, context.signal)
        context.commit({ sourceRef: record.sourceRef, displayName: record.displayName,
          exists: true, banned: record.status === 'banned', record })
        return true
      } catch (error) {
        // Do not infer completion from Mongo read-back: Redis propagation may have failed after commit.
        if (!context.current()) throw resourceCancelled()
        if (definitelyRejectedBan(error)) {
          if (banAuthorizationRejected(error)) this.identity.invalidate(identity.account)
          throw error
        }
        throw new UnconfirmedBanError(banned, error)
      } finally { context.invalidate() }
    }) ?? false
  }
}

export const privateChatActions = new PrivateChatActionsStore({
  identity: (_binding, signal) => callArkme('user.profile.refresh', {}, signal),
  eligibility: (binding, signal) => callArkme('related-recordings.eligibility', { sourceRef: binding.source.sourceRef }, signal),
  admission: (binding, signal) => callArkme('chat.direct-message-admission', { sourceRef: binding.source.sourceRef }, signal),
  setRefused: (binding, refused, expectedRevision, signal) => callArkme('chat.direct-message-refusal.set', { sourceRef: binding.source.sourceRef, refused, expectedRevision }, signal),
  banStatus: (binding, signal) => callArkme('user-ban.status', { sourceRef: binding.source.sourceRef }, signal),
  setBanned: (binding, banned, signal) => callArkme(banned ? 'user-ban.ban' : 'user-ban.unban', { sourceRef: binding.source.sourceRef, remark: '' }, signal),
})
