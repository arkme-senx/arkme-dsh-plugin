import type { ArkmeInterwovenReadReceipt, ArkmeInterwovenReadReceiptList } from '../types.js'
import { callArkme } from './api.js'

type Target = { momentId: string; momentRef: string; visible: boolean }
type Loader = (refs: string[], signal: AbortSignal) => Promise<ArkmeInterwovenReadReceiptList>

/** One private-conversation/account lifetime. Visible rows only; no read acknowledgements. */
export class InterwovenReadReceiptStore {
  private targets = new Map<symbol, Target>()
  private entries = new Map<string, ArkmeInterwovenReadReceipt>()
  private listeners = new Set<() => void>()
  private timer: ReturnType<typeof setTimeout> | undefined
  private controller: AbortController | undefined
  private foreground = true
  private disposed = false
  private generation = 0
  private failures = 0

  constructor(sourceRef: string, private load: Loader = (momentRefs, signal) => callArkme(
    'source.interwoven-read-receipts', { sourceRef, momentRefs }, signal,
  )) {}

  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener) } }
  get = (ref: string) => this.entries.get(ref)

  register(momentId: string, momentRef: string) {
    const key = Symbol()
    this.targets.set(key, { momentId, momentRef, visible: false })
    return {
      setVisible: (visible: boolean) => {
        const target = this.targets.get(key)
        if (!target || target.visible === visible) return
        target.visible = visible
        if (visible) this.refresh()
        else if (!this.visible().length) this.cancel()
      },
      dispose: () => {
        this.targets.delete(key)
        if (![...this.targets.values()].some(item => item.momentRef === momentRef)) this.entries.delete(momentRef)
        if (!this.visible().length) this.cancel()
      },
    }
  }

  private visible() { return [...new Map([...this.targets.values()].filter(item => item.visible).map(item => [item.momentRef, item])).values()] }
  private cancel() {
    this.generation++
    clearTimeout(this.timer); this.timer = undefined
    this.controller?.abort(); this.controller = undefined
  }
  private schedule(delay: number) {
    clearTimeout(this.timer)
    if (!this.disposed && this.foreground && this.visible().length) this.timer = setTimeout(() => { void this.flush() }, delay)
  }
  refresh = () => { this.cancel(); this.schedule(100) }
  activate() { this.disposed = false; this.refresh() }
  setForeground(value: boolean) {
    if (this.foreground === value) return
    this.foreground = value
    this.cancel()
    if (value) this.schedule(0)
  }
  dispose() { this.disposed = true; this.cancel(); this.targets.clear(); this.entries.clear(); this.listeners.clear() }

  private async flush() {
    if (this.disposed || !this.foreground) return
    this.timer = undefined
    const targets = this.visible()
    const generation = this.generation
    const controller = new AbortController()
    this.controller = controller
    let failed = false
    for (let start = 0; start < targets.length; start += 20) {
      if (controller.signal.aborted) return
      const batch = targets.slice(start, start + 20)
      try {
        const result = await this.load(batch.map(item => item.momentRef), controller.signal)
        if (controller.signal.aborted || generation !== this.generation || this.disposed) return
        for (const target of batch) {
          const matching = result.items.filter(item => item.momentId === target.momentId)
          const item = matching.length === 1 ? matching[0] : undefined
          if (item && ['read', 'unread', 'unknown'].includes(item.status)) this.entries.set(target.momentRef, item)
          else this.entries.delete(target.momentRef)
        }
      } catch {
        if (controller.signal.aborted) return
        failed = true
        // Do not leave a stale unread dot after a permission/network failure.
        for (const target of batch) this.entries.delete(target.momentRef)
      }
      for (const listener of this.listeners) listener()
    }
    if (generation !== this.generation || this.disposed) return
    this.controller = undefined
    this.failures = failed ? this.failures + 1 : 0
    if (this.visible().some(target => this.entries.get(target.momentRef)?.status !== 'read')) {
      this.schedule(failed ? Math.min(60_000, 15_000 * 2 ** this.failures)
        : this.visible().every(target => this.entries.get(target.momentRef)?.status === 'unknown') ? 60_000 : 15_000)
    }
  }
}
