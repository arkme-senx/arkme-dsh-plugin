import type { ArkmeSessionCredentials, ArkmeSessionStore } from './keychain-store.js'
import {
  arkmeDesktopBridgeConfigFromEnv,
  requestArkmeDesktopBridge,
  type ArkmeDesktopBridgeConfig,
} from './services/desktop-attention-bridge.js'
import type { FetchLike } from './services/service.js'

export type ArkmeAccountScopeIdentity =
  | { kind: 'guest' }
  | { kind: 'account'; userId: number; claimCurrentGuest?: boolean }

export interface ArkmeAccountScopeBridge {
  attest(identity: ArkmeAccountScopeIdentity): Promise<{ status: 'ready' | 'relaunch' }>
  prepare(identity: ArkmeAccountScopeIdentity): Promise<{ transitionRef: string }>
  commit(transitionRef: string): Promise<{ status: 'ready' | 'relaunch' }>
  abort(transitionRef: string): Promise<{ status: 'ready' }>
}

export class ArkmeAccountSessionOwner {
  private readyIdentity: string | undefined
  private startTask: Promise<void> | undefined
  private mutationTail: Promise<void> = Promise.resolve()
  private readonly listeners = new Set<() => void>()
  private guestConversationProbe: () => Promise<boolean> = async () => true

  constructor(
    private readonly store: ArkmeSessionStore,
    private readonly bridge?: ArkmeAccountScopeBridge,
    private readonly bridgeRequired = false,
  ) {}

  start(): Promise<void> {
    this.startTask ??= this.attestCurrent()
    return this.startTask
  }

  attachGuestConversationProbe(probe: () => Promise<boolean>): void {
    this.guestConversationProbe = probe
  }

  async write(session: ArkmeSessionCredentials): Promise<void> {
    await this.start()
    await this.serial(async () => {
      const current = await this.store.read()
      if (current?.userId === session.userId) {
        await this.store.write(session)
        return
      }
      const claimCurrentGuest = current === undefined ? await this.guestConversationProbe() : undefined
      await this.transition({
        kind: 'account',
        userId: session.userId,
        ...(claimCurrentGuest === undefined ? {} : { claimCurrentGuest }),
      }, async () => {
        await this.store.write(session)
      })
    })
  }

  async delete(): Promise<void> {
    await this.start()
    await this.serial(async () => {
      const current = await this.store.read()
      if (current === undefined) return
      await this.transition({ kind: 'guest' }, async () => {
        await this.store.delete()
      })
    })
  }

  async scopedSession(): Promise<ArkmeSessionCredentials | undefined> {
    if (this.startTask === undefined) return undefined
    await this.startTask
    const session = await this.store.read()
    if (this.bridge === undefined && !this.bridgeRequired) {
      this.setReady(identityKey(session === undefined ? { kind: 'guest' } : { kind: 'account', userId: session.userId }))
    }
    return session !== undefined && this.readyIdentity === identityKey({ kind: 'account', userId: session.userId })
      ? session
      : undefined
  }

  ready(): boolean { return this.readyIdentity !== undefined }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    listener()
    return () => { this.listeners.delete(listener) }
  }

  private async attestCurrent(): Promise<void> {
    const session = await this.store.read()
    const identity: ArkmeAccountScopeIdentity = session === undefined
      ? { kind: 'guest' }
      : { kind: 'account', userId: session.userId }
    if (this.bridge === undefined) {
      if (this.bridgeRequired) throw new Error('Arkme desktop account scope bridge is required')
      this.setReady(identityKey(identity))
      return
    }
    const result = await this.bridge.attest(identity)
    this.setReady(result.status === 'ready' ? identityKey(identity) : undefined)
  }

  private async transition(identity: ArkmeAccountScopeIdentity, mutate: () => Promise<void>): Promise<void> {
    if (this.bridge === undefined) {
      if (this.bridgeRequired) throw new Error('Arkme desktop account scope bridge is required')
      await mutate()
      this.setReady(identityKey(identity))
      return
    }
    const previousIdentity = this.readyIdentity
    const prepared = await this.bridge.prepare(identity)
    this.setReady(undefined)
    try { await mutate() }
    catch (error) {
      try { await this.bridge.abort(prepared.transitionRef) }
      finally { this.setReady(previousIdentity) }
      throw error
    }
    const committed = await this.bridge.commit(prepared.transitionRef)
    this.setReady(committed.status === 'ready' ? identityKey(identity) : undefined)
  }

  private async serial(action: () => Promise<void>): Promise<void> {
    const pending = this.mutationTail.then(action)
    this.mutationTail = pending.catch(() => undefined)
    await pending
  }

  private setReady(identity: string | undefined): void {
    if (this.readyIdentity === identity) return
    this.readyIdentity = identity
    for (const listener of this.listeners) listener()
  }
}

export function createArkmeAccountSessionOwner(
  store: ArkmeSessionStore,
  fetchImpl: FetchLike,
  env: Readonly<Record<string, string | undefined>> = process.env,
): ArkmeAccountSessionOwner {
  const required = env.ARKME_ACCOUNT_SCOPE_REQUIRED === '1'
  const config = required ? arkmeDesktopBridgeConfigFromEnv(env) : undefined
  return new ArkmeAccountSessionOwner(
    store,
    config === undefined ? undefined : new HttpArkmeAccountScopeBridge(config, fetchImpl),
    required,
  )
}

class HttpArkmeAccountScopeBridge implements ArkmeAccountScopeBridge {
  constructor(
    private readonly config: ArkmeDesktopBridgeConfig,
    private readonly fetchImpl: FetchLike,
  ) {}

  async attest(identity: ArkmeAccountScopeIdentity): Promise<{ status: 'ready' | 'relaunch' }> {
    return status(await this.request('account.scope.attest', identity))
  }

  async prepare(identity: ArkmeAccountScopeIdentity): Promise<{ transitionRef: string }> {
    const value = await this.request('account.scope.prepare', identity)
    const transitionRef = typeof value.transitionRef === 'string' ? value.transitionRef : ''
    if (!/^[A-Za-z0-9._:-]{8,160}$/.test(transitionRef)) throw new Error('Desktop account scope prepare response is invalid')
    return { transitionRef }
  }

  async commit(transitionRef: string): Promise<{ status: 'ready' | 'relaunch' }> {
    return status(await this.request('account.scope.commit', { transitionRef }))
  }

  async abort(transitionRef: string): Promise<{ status: 'ready' }> {
    const result = status(await this.request('account.scope.abort', { transitionRef }))
    if (result.status !== 'ready') throw new Error('Desktop account scope abort response is invalid')
    return { status: 'ready' }
  }

  private async request(action: Parameters<typeof requestArkmeDesktopBridge>[2], payload: object): Promise<Record<string, unknown>> {
    return await requestArkmeDesktopBridge(this.config, this.fetchImpl, action, payload)
  }
}

function status(value: Record<string, unknown>): { status: 'ready' | 'relaunch' } {
  if (value.status !== 'ready' && value.status !== 'relaunch') throw new Error('Desktop account scope response is invalid')
  return { status: value.status }
}

function identityKey(identity: ArkmeAccountScopeIdentity): string {
  if (identity.kind === 'guest') return 'guest'
  if (!Number.isSafeInteger(identity.userId) || identity.userId <= 0) throw new Error('Arkme account scope identity is invalid')
  return `account:${String(identity.userId)}`
}
