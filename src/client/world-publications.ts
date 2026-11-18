import type { WorldPublication, WorldPublicationSourceTarget } from '../world-publication-contract.js'
import { callArkme } from './api.js'
export type PublicationTarget = { source: WorldPublicationSourceTarget } | { recordRef: string }
export interface PublicationState {
  loading: boolean
  publications: WorldPublication[]
  error?: string
}
const empty: PublicationState = { loading: true, publications: [] }
interface Entry {
  account: string
  target: PublicationTarget
  state: PublicationState
  queued: boolean
  listeners: Set<() => void>
}
/** One bounded queue for visible blocks and details; cache never crosses an account. */
export class WorldPublicationStore {
  private entries = new Map<string, Entry>()
  private timer: ReturnType<typeof setTimeout> | undefined
  private generation = 0
  private controllers = new Set<AbortController>()
  constructor(private call: typeof callArkme = callArkme) {}
  key(account: string, target: PublicationTarget) {
    return JSON.stringify([account, target])
  }
  snapshot(key: string): PublicationState {
    return this.entries.get(key)?.state ?? empty
  }
  subscribe(account: string, target: PublicationTarget, listener: () => void) {
    const key = this.key(account, target)
    let entry = this.entries.get(key)
    if (!entry) {
      entry = { account, target, state: empty, queued: true, listeners: new Set() }
      this.entries.set(key, entry)
      this.schedule()
    }
    entry.listeners.add(listener)
    return () => {
      entry.listeners.delete(listener)
      if (this.entries.size > 500)
        for (const [k, e] of this.entries) {
          if (!e.listeners.size) this.entries.delete(k)
          if (this.entries.size <= 400) break
        }
    }
  }
  retry(key: string) {
    const e = this.entries.get(key)
    if (e && !e.state.loading) {
      e.queued = true
      e.state = { loading: true, publications: e.state.publications }
      this.notify(e)
      this.schedule()
    }
  }
  remove(publicationKey: string) {
    for (const entry of this.entries.values()) {
      if (!entry.state.publications.some(p => p.key === publicationKey)) continue
      entry.state = { ...entry.state, publications: entry.state.publications.filter(p => p.key !== publicationKey) }
      this.notify(entry)
    }
  }
  invalidate() {
    this.generation++
    for (const controller of this.controllers) controller.abort()
    this.controllers.clear()
    for (const [key, e] of this.entries) {
      if (!e.listeners.size) {
        this.entries.delete(key)
        continue
      }
      e.queued = true
      e.state = { loading: true, publications: e.state.publications }
      this.notify(e)
    }
    this.schedule()
  }
  private notify(e: Entry) {
    for (const listener of e.listeners) listener()
  }
  private schedule() {
    if (!this.timer)
      this.timer = setTimeout(() => {
        this.timer = undefined
        void this.flush()
      }, 25)
  }
  private async flush() {
    const generation = this.generation
    const entries = [...this.entries.values()].filter((e) => e.queued)
    for (const e of entries) e.queued = false
    const groups: Entry[][] = []
    for (const e of entries) {
      const group =
        'source' in e.target
          ? groups.find((g) => g.length < 50 && g[0]!.account === e.account && 'source' in g[0]!.target)
          : undefined
      if (group) group.push(e)
      else groups.push([e])
    }
    await Promise.all(
      groups.map(async (group) => {
        const controller = new AbortController(),
          timer = setTimeout(() => controller.abort(), 20_000)
        this.controllers.add(controller)
        try {
          const first = group[0]!
          let values: { itemUid?: string; publications: WorldPublication[] }[]
          if ('source' in first.target) {
            // Different signed references can represent the same item; never submit duplicate IDs.
            const targets = [
              ...new Map(
                group.map((e) => {
                  const t = (e.target as { source: WorldPublicationSourceTarget }).source
                  return [t.itemUid, t]
                }),
              ).values(),
            ]
            const result = await this.call<{ items: { itemUid: string; publications: WorldPublication[] }[] }>(
              'world.publications',
              { action: 'sources', accountKey: first.account, targets },
              controller.signal,
            )
            if (
              !Array.isArray(result.items) ||
              result.items.length !== targets.length ||
              targets.some((t) => !result.items.some((v) => v.itemUid === t.itemUid))
            )
              throw new Error('发布状态返回不完整')
            values = group.map(
              (e) =>
                result.items.find(
                  (v) => v.itemUid === (e.target as { source: WorldPublicationSourceTarget }).source.itemUid,
                )!,
            )
          } else
            values = [
              await this.call<{ publications: WorldPublication[] }>(
                'world.publications',
                { action: 'management', accountKey: first.account, recordRef: first.target.recordRef },
                controller.signal,
              ),
            ]
          if (generation !== this.generation) return
          group.forEach((e, i) => {
            e.state = { loading: false, publications: values[i]!.publications }
            this.notify(e)
          })
        } catch (error) {
          if (generation !== this.generation) return
          group.forEach((e) => {
            e.state = {
              loading: false,
              publications: e.state.publications,
              error: controller.signal.aborted
                ? '查询公开状态超时，请重试'
                : error instanceof Error
                  ? error.message
                  : '无法查询公开状态',
            }
            this.notify(e)
          })
        } finally {
          clearTimeout(timer)
          this.controllers.delete(controller)
        }
      }),
    )
  }
}
export const worldPublications = new WorldPublicationStore()
if (typeof window !== 'undefined') {
  window.addEventListener('arkme-world-publications-changed', () => worldPublications.invalidate())
  window.addEventListener('focus', () => worldPublications.invalidate())
}
