import type { ArkmeConversationViewportSnapshot } from './conversation-memory-cache.js'

const PREFIX = 'arkme:reading:v1:'
const MAX_BYTES = 64 * 1024
const byteLength = (value: string) => new TextEncoder().encode(value).byteLength
/** Only geometry and opaque row identities; no message bodies, credentials or server cursors. */
export class ConversationViewportPersistence {
  private account: string | undefined
  private key = ''
  private readonly values = new Map<string, ArkmeConversationViewportSnapshot>()
  private timer: ReturnType<typeof setTimeout> | undefined
  constructor(private readonly storage: () => Storage | undefined = () => typeof window === 'undefined' ? undefined : window.localStorage) {}
  setScope(account: string | undefined, surface = 'main'): void {
    const key = `${PREFIX}${surface}`
    if (this.account === account && this.key === key) return
    this.flush(); this.values.clear(); this.account = account; this.key = key
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
  storeViewport(source: string, viewport: ArkmeConversationViewportSnapshot): void {
    if (!this.account || source.length > 2048 || !Number.isFinite(viewport.scrollTop) || viewport.scrollTop < 0
      || viewport.anchorId !== undefined && viewport.anchorId.length > 1024
      || viewport.anchorOffset !== undefined && !Number.isFinite(viewport.anchorOffset)) return
    this.values.delete(source); this.values.set(source, viewport)
    while (this.values.size > 40) this.values.delete(this.values.keys().next().value!)
    if (this.timer === undefined) this.timer = setTimeout(() => this.flush(), 250)
  }
  flush = (): void => {
    clearTimeout(this.timer); this.timer = undefined
    if (!this.account || !this.key) return
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
