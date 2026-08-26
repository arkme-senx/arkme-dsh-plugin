import type { ArkmeAuthSnapshot, ArkmeClientConfig } from '../types.js'
import { callArkme } from './api.js'

export interface ArkmeAuthStoreSnapshot {
  auth: ArkmeAuthSnapshot | undefined
  config: ArkmeClientConfig | undefined
  checked: boolean
  busy: boolean
  error: string
  revision: number
}

function nextRevision(current: ArkmeAuthStoreSnapshot): number {
  return current.revision + 1
}

function sameAuth(left: ArkmeAuthSnapshot | undefined, right: ArkmeAuthSnapshot | undefined): boolean {
  return left?.status === right?.status
    && left?.environment === right?.environment
    && left?.userId === right?.userId
    && left?.attemptId === right?.attemptId
    && left?.expiresAtMillis === right?.expiresAtMillis
}

export class ArkmeAuthStore {
  private state: ArkmeAuthStoreSnapshot = {
    auth: undefined,
    config: undefined,
    checked: false,
    busy: false,
    error: '',
    revision: 0,
  }

  private inFlight: Promise<ArkmeAuthSnapshot> | undefined
  private authGeneration = 0
  private readonly listeners = new Set<() => void>()

  readonly getSnapshot = (): ArkmeAuthStoreSnapshot => this.state

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  setAuth(auth: ArkmeAuthSnapshot): void {
    if (sameAuth(this.state.auth, auth) && this.state.checked && !this.state.busy && this.state.error === '') return
    this.authGeneration += 1
    this.publish({ ...this.state, auth, checked: true, busy: false, error: '', revision: nextRevision(this.state) })
  }

  setError(error: string): void {
    this.publish({ ...this.state, checked: true, busy: false, error, revision: nextRevision(this.state) })
  }

  async refresh(): Promise<ArkmeAuthSnapshot> {
    if (this.inFlight !== undefined) return await this.inFlight
    const authGeneration = this.authGeneration
    this.publish({ ...this.state, busy: true, error: '', revision: nextRevision(this.state) })
    const pending = Promise.all([
      callArkme<ArkmeAuthSnapshot>('auth.status'),
      callArkme<ArkmeClientConfig>('auth.config'),
    ]).then(([auth, config]) => {
      const currentAuth = this.state.auth
      const preservePendingAttempt = currentAuth?.status === 'pending'
        && (auth.status === 'logged-out' || auth.status === 'expired')
      const effectiveAuth = this.authGeneration === authGeneration && !preservePendingAttempt
        ? auth
        : currentAuth ?? auth
      this.publish({
        ...this.state,
        auth: effectiveAuth,
        config,
        checked: true,
        busy: false,
        error: '',
        revision: nextRevision(this.state),
      })
      return effectiveAuth
    }).catch(error => {
      const message = error instanceof Error ? error.message : String(error)
      this.publish({ ...this.state, checked: true, busy: false, error: message, revision: nextRevision(this.state) })
      throw error
    }).finally(() => {
      if (this.inFlight === pending) this.inFlight = undefined
    })
    this.inFlight = pending
    return await pending
  }

  private publish(next: ArkmeAuthStoreSnapshot): void {
    if (next.auth === this.state.auth && next.config === this.state.config && next.checked === this.state.checked
      && next.busy === this.state.busy && next.error === this.state.error && next.revision === this.state.revision) return
    this.state = next
    for (const listener of this.listeners) listener()
  }
}

export const arkmeAuthStore = new ArkmeAuthStore()
