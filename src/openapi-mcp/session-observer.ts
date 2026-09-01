import type { ArkmeSessionCredentials, ArkmeSessionStore } from '../keychain-store.js'
import { sameOpenApiMcpPrincipal } from './types.js'

export interface SessionTransitionObserver<Ticket = unknown> {
  prepare(previous: ArkmeSessionCredentials | undefined, next: ArkmeSessionCredentials | undefined): Promise<Ticket>
  committed(ticket: Ticket): void
  rolledBack(ticket: Ticket): void
}

/** Adds principal-change observation without teaching the auth service about managed OpenAPI credentials. */
export class ObservedArkmeSessionStore<Ticket = unknown> implements ArkmeSessionStore {
  private observer: SessionTransitionObserver<Ticket> | undefined
  private mutations: Promise<void> = Promise.resolve()

  constructor(private readonly inner: ArkmeSessionStore) {}

  attach(observer: SessionTransitionObserver<Ticket>): void {
    if (this.observer !== undefined) throw new Error('Arkme session transition observer is already attached')
    this.observer = observer
  }

  async read(): Promise<ArkmeSessionCredentials | undefined> {
    return await this.inner.read()
  }

  async write(session: ArkmeSessionCredentials): Promise<void> {
    await this.mutate(session, async () => { await this.inner.write(session) })
  }

  async delete(): Promise<void> {
    await this.mutate(undefined, async () => { await this.inner.delete() })
  }

  private async mutate(next: ArkmeSessionCredentials | undefined, commit: () => Promise<void>): Promise<void> {
    const operation = async (): Promise<void> => {
      const previous = await this.inner.read()
      if (sameOpenApiMcpPrincipal(previous, next)) {
        await commit()
        return
      }
      const observer = this.observer
      if (observer === undefined) {
        await commit()
        return
      }
      const ticket = await observer.prepare(previous, next)
      try {
        await commit()
      } catch (error) {
        observer.rolledBack(ticket)
        throw error
      }
      observer.committed(ticket)
    }
    const current = this.mutations.then(operation, operation)
    this.mutations = current.catch(() => undefined)
    await current
  }
}
