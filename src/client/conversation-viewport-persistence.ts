import type { ArkmeConversationViewportSnapshot } from './conversation-memory-cache.js'
import { normalizeConversationViewports, type ConversationViewportEntries } from '../conversation-viewport-state.js'

interface DurableViewports {
  read(account: string, surface: string, signal?: AbortSignal): Promise<unknown>
  write(account: string, surface: string, entries: ConversationViewportEntries): Promise<unknown>
}

const PREFIX = 'arkme:reading:v1:'
const MAX_BYTES = 64 * 1024
const byteLength = (value: string) => new TextEncoder().encode(value).byteLength
/** Only geometry and opaque row identities; no message bodies, credentials or server cursors. */
export class ConversationViewportPersistence {
  private account: string | undefined
  private key = ''
  private readonly values = new Map<string, ArkmeConversationViewportSnapshot>()
  private timer: ReturnType<typeof setTimeout> | undefined
  private epoch = 0
  private hydration: Promise<void> | undefined
  private hydrationController: AbortController | undefined
  private readonly touched = new Set<string>()
  private readonly durablePending = new Map<string, { account: string; surface: string; entries: ConversationViewportEntries; fingerprint: string }>()
  private readonly durableSaved = new Map<string, string>()
  private durableFlight: Promise<void> | undefined
  constructor(private readonly storage: () => Storage | undefined = () => typeof window === 'undefined' ? undefined : window.localStorage,
    private readonly durable?: DurableViewports) {}
  setScope(account: string | undefined, surface = 'main'): void {
    const key = `${PREFIX}${surface}`
    if (this.account === account && this.key === key) return
    this.flush(); this.values.clear(); this.account = account; this.key = key
    this.epoch++; this.hydrationController?.abort(); this.hydrationController = undefined
    this.hydration = undefined; this.touched.clear()
    if (!account) return
    try {
      const storage = this.storage()
      const raw = storage?.getItem(key)
      if (raw && raw.length <= MAX_BYTES && byteLength(raw) <= MAX_BYTES) {
        const saved = JSON.parse(raw)
        if (saved.account === account && Array.isArray(saved.entries)) {
          for (const [source, value] of saved.entries.slice(-40)) {
            if (typeof source !== 'string' || source.length > 2048 || !value || typeof value.stickToBottom !== 'boolean'
              || !Number.isFinite(value.scrollTop) || value.scrollTop < 0
              || value.anchorId !== undefined && (typeof value.anchorId !== 'string' || value.anchorId.length > 1024)
              || value.anchorOffset !== undefined && !Number.isFinite(value.anchorOffset)) continue
            this.values.set(source, { scrollTop: value.scrollTop, stickToBottom: value.stickToBottom,
              ...(value.anchorId === undefined ? {} : { anchorId: value.anchorId }),
              ...(value.anchorOffset === undefined ? {} : { anchorOffset: value.anchorOffset }) })
          }
        }
      }
      // Native conversation windows have one stable source-specific namespace.
      // Bound closed-window geometry independently of the message cache.
      if (storage) {
        const keys = Array.from({ length: storage.length }, (_, index) => storage.key(index)).filter((value): value is string => !!value?.startsWith(PREFIX) && value !== key)
        for (const old of keys.slice(0, Math.max(0, keys.length - 39))) storage.removeItem(old)
      }
    } catch { /* Private mode or corrupt geometry cannot prevent opening a conversation. */ }
  }
  getViewport(source: string): ArkmeConversationViewportSnapshot | undefined { return this.values.get(source) }
  /** Host storage survives ephemeral Harness ports; hydrate before choosing the cache anchor. */
  async hydrate(signal?: AbortSignal): Promise<void> {
    if (!this.durable || !this.account || signal?.aborted) return
    if (this.hydration) return this.hydration
    const epoch = this.epoch, account = this.account, surface = this.key.slice(PREFIX.length)
    // Conversation requests may replace each other. The shared account/surface read
    // owns cancellation so an outgoing conversation cannot poison the next restore.
    const controller = this.hydrationController = new AbortController()
    const readSignal = AbortSignal.any([controller.signal, AbortSignal.timeout(5000)])
    this.hydration = this.durable.read(account, surface, readSignal).then(value => {
      if (epoch !== this.epoch) return
      readSignal.throwIfAborted()
      // Durable geometry wins over stale origins; a new user scroll wins over a late restore.
      const local = new Map(this.values)
      const restored = normalizeConversationViewports(value)
      this.values.clear()
      for (const [source, viewport] of restored) this.values.set(source, viewport)
      for (const [source, viewport] of local) if (!this.values.has(source) || this.touched.has(source)) {
        this.values.delete(source); this.values.set(source, viewport)
      }
      while (this.values.size > 40) this.values.delete(this.values.keys().next().value!)
      const key = `${account}:${surface}`
      if (!this.durableSaved.has(key)) this.rememberDurable(key, JSON.stringify(restored))
    }).catch(() => {
      // Retain the origin-local fallback and allow the next conversation to retry.
      if (epoch === this.epoch) this.hydration = undefined
    })
    return this.hydration
  }

  private rememberDurable(key: string, value: string): void {
    this.durableSaved.delete(key); this.durableSaved.set(key, value)
    while (this.durableSaved.size > 40) this.durableSaved.delete(this.durableSaved.keys().next().value!)
  }

  /** Single flight, latest snapshot per scope, no retry loop or per-scroll I/O. */
  async settle(): Promise<void> {
    if (!this.durable) return
    if (this.durableFlight) return this.durableFlight
    this.durableFlight = (async () => {
      while (this.durablePending.size) {
        const [key, pending] = this.durablePending.entries().next().value!
        this.durablePending.delete(key)
        try {
          await this.durable!.write(pending.account, pending.surface, pending.entries)
        } catch {
          if (this.durableSaved.get(key) === pending.fingerprint) this.durableSaved.delete(key)
          // Geometry stays in memory/origin storage; a later flush can retry.
        }
      }
    })().finally(() => {
      this.durableFlight = undefined
      if (this.durablePending.size) void this.settle()
    })
    return this.durableFlight
  }
  storeViewport(source: string, viewport: ArkmeConversationViewportSnapshot): void {
    if (!this.account || source.length > 2048 || !Number.isFinite(viewport.scrollTop) || viewport.scrollTop < 0
      || viewport.anchorId !== undefined && viewport.anchorId.length > 1024
      || viewport.anchorOffset !== undefined && !Number.isFinite(viewport.anchorOffset)) return
    this.values.delete(source); this.values.set(source, viewport)
    this.touched.delete(source); this.touched.add(source)
    while (this.touched.size > 40) this.touched.delete(this.touched.values().next().value!)
    while (this.values.size > 40) this.values.delete(this.values.keys().next().value!)
    if (this.timer === undefined) this.timer = setTimeout(() => this.flush(), 250)
  }
  flush = (): void => {
    clearTimeout(this.timer); this.timer = undefined
    if (!this.account || !this.key) return
    if (this.durable && this.values.size) {
      const entries = normalizeConversationViewports([...this.values])
      const surface = this.key.slice(PREFIX.length), key = `${this.account}:${surface}`, fingerprint = JSON.stringify(entries)
      if (fingerprint !== this.durableSaved.get(key)) {
        this.rememberDurable(key, fingerprint)
        this.durablePending.delete(key)
        this.durablePending.set(key, { account: this.account, surface, entries, fingerprint })
        while (this.durablePending.size > 40) this.durablePending.delete(this.durablePending.keys().next().value!)
        void this.settle()
      }
    }
    try {
      const entries = [...this.values]
      let serialized = JSON.stringify({ account: this.account, entries })
      while (entries.length && byteLength(serialized) > MAX_BYTES) {
        entries.shift()
        serialized = JSON.stringify({ account: this.account, entries })
      }
      if (byteLength(serialized) <= MAX_BYTES) this.storage()?.setItem(this.key, serialized)
    } catch { /* Memory-only geometry remains usable. */ }
  }
}
