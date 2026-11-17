import { AsyncLocalStorage } from 'node:async_hooks'
import type { ArkmeSessionCredentials } from '../keychain-store.js'
import type { ArkmeRemoteRequestOptions } from './service.js'

export interface OrderedChatSend {
  body: Record<string, unknown>
  session: ArkmeSessionCredentials
  signal: AbortSignal | undefined
  options: ArkmeRemoteRequestOptions
  refreshOnUnauthorized?: boolean
  scalar(): Promise<unknown>
  resolve(value: unknown): void
  reject(error: unknown): void
}

/** Collect only the existing native-send transport; all preparation and result handling keep their owner. */
export class OrderedChatSends {
  private readonly context = new AsyncLocalStorage<{ group: Group; index: number }>()
  constructor(private readonly dispatch: (entries: OrderedChatSend[]) => Promise<void>) {}

  capture<T>(entry: Omit<OrderedChatSend, 'resolve' | 'reject'>): Promise<T> | undefined {
    const current = this.context.getStore()
    if (!current || current.group.entries.has(current.index)) return undefined
    return new Promise<T>((resolve, reject) => {
      current.group.entries.set(current.index, { ...entry, resolve: value => resolve(value as T), reject })
      current.group.flush()
    })
  }

  async run(actions: readonly (() => Promise<void>)[]): Promise<void> {
    if (actions.length < 2) { for (const action of actions) await action(); return }
    if (actions.length > 5) throw new RangeError('Ordered sends are limited to five items')
    let dispatched = false
    const group: Group = { entries: new Map(), finished: new Set(), flush: () => {
      if (dispatched || actions.some((_, index) => !group.entries.has(index) && !group.finished.has(index))) return
      dispatched = true
      const entries = [...group.entries].sort(([left], [right]) => left - right).map(([, entry]) => entry)
      if (entries.length) void this.dispatch(entries).catch(error => { for (const entry of entries) entry.reject(error) })
    } }
    const results = await Promise.allSettled(actions.map((action, index) => this.context.run({ group, index }, action).finally(() => {
      group.finished.add(index); group.flush()
    })))
    const failed = results.find(result => result.status === 'rejected')
    if (failed?.status === 'rejected') throw failed.reason
  }
}

interface Group {
  entries: Map<number, OrderedChatSend>
  finished: Set<number>
  flush(): void
}
