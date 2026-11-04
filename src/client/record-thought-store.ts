import type { ArkmeRecordThought, ArkmeRecordThoughts, ArkmeThoughtStreamUpdate } from '../record-thought-contract.js'

export interface RecordThoughtState { items: readonly ArkmeRecordThought[]; loading: boolean; error: string; loaded?: boolean; focusRevision?: number }
const EMPTY: RecordThoughtState = Object.freeze({ items: [], loading: false, error: '' })
type Watch = { listeners: Set<() => void>; sentAt: number; version: number; actionRef?: string | undefined; timelineItemKey?: string | undefined }
type Reader = (scope: string, recordUids: string[], signal: AbortSignal, actionRefs: string[]) => Promise<ArkmeRecordThoughts>

/** One visible self workspace owns batches; list entries and details share results. */
export class RecordThoughtStore {
  private ephemeral = new Map<string, { item: ArkmeRecordThought; at: number; bytes: number }>()
  private invalidationEpochs = new Map<string, number>()
  private states = new Map<string, RecordThoughtState>()
  private readAt = new Map<string, number>()
  private versions = new Map<string, number>()
  private watchers = new Map<string, Watch>()
  private pending = new Set<string>()
  private inFlightUids = new Set<string>()
  private controller: AbortController | undefined
  private batchTimer: ReturnType<typeof setTimeout> | undefined
  private pollTimer: ReturnType<typeof setTimeout> | undefined
  private active = false
  private generation = 0
  private focusUid: string | undefined
  private failures = 0
  constructor(readonly scope: string, private readonly read: Reader) {}
  get = (uid: string): RecordThoughtState => this.states.get(uid) ?? EMPTY
  subscribe(uid: string, sentAt: number, version: number, listener: () => void, actionRef?: string, timelineItemKey?: string): () => void {
    const notify = () => listener()
    const watch = this.watchers.get(uid) ?? { listeners: new Set(), sentAt, version }
    const changed = this.versions.get(uid) !== version
    if (changed && this.versions.has(uid)) {
      this.publish(uid, { items: [], loading: false, error: '' }); this.ephemeral.delete(uid)
    }
    this.versions.set(uid, version)
    watch.actionRef = actionRef; watch.timelineItemKey = timelineItemKey
    watch.version = version; watch.sentAt = sentAt; watch.listeners.add(notify); this.watchers.set(uid, watch)
    if (changed && this.inFlightUids.has(uid)) this.pending.add(uid)
    if (changed || Date.now() - (this.readAt.get(uid) ?? 0) > 30_000) this.queue([uid])
    this.schedulePoll()
    return () => {
      watch.listeners.delete(notify)
      if (!watch.listeners.size) { this.watchers.delete(uid); this.pending.delete(uid) }
      if (!this.watchers.size) this.stop()
    }
  }
  setActive(active: boolean): void {
    if (this.active === active) return
    this.active = active
    if (active) this.refresh()
    else this.stop()
  }
  refresh(uid?: string): void {
    const uids = uid ? [uid] : [...this.watchers.keys()]
    for (const uid of uids) if (this.inFlightUids.has(uid)) this.pending.add(uid)
    this.queue(uids)
  }
  applyStream(update: ArkmeThoughtStreamUpdate): void {
    const uid = update.recordUid
    if (!this.active || !this.watchers.has(uid)) return
    if (!Number.isSafeInteger(update.sourceVersion) || update.sourceVersion!<=0 || update.sourceVersion !== this.versions.get(uid)) { if(update.phase!=='generating') this.refresh(uid); return }
    const previous = this.ephemeral.get(uid)
    // A reconnect may resume in the middle. Never append a duplicated or missing range.
    const bytes = new TextEncoder().encode(update.delta).length
    if (previous?.item.id === update.streamId && update.contentBytes > 0 && update.contentBytes <= previous.bytes && update.phase === 'generating') return
    if (previous?.item.id === update.streamId && !update.delta && update.phase === 'generating') return
    if (update.phase !== 'failed' && update.contentBytes > 0 && update.contentBytes !== (previous?.item.id === update.streamId ? previous.bytes : 0) + bytes) { this.refresh(uid); return }
    const content = `${previous?.item.id === update.streamId ? previous.item.content : ''}${update.delta}`.slice(0, 131_072)
    const item: ArkmeRecordThought = {sourceVersion:update.sourceVersion!,currentSourceVersion:update.sourceVersion!,id: update.streamId, recordUid: uid, content, biz: update.biz, status: update.phase }
    this.ephemeral.set(uid, { item, at: Date.now(), bytes: update.contentBytes || new TextEncoder().encode(content).length })
    this.publish(uid, { ...this.get(uid), items: [...this.get(uid).items.filter(item => item.biz !== update.biz), item], error: '' })
    if (update.phase !== 'generating') this.refresh(uid)
    this.schedulePoll()
  }
  invalidate(timelineItemKey?: string): void {
    for (const [uid, watch] of this.watchers) if (!timelineItemKey || watch.timelineItemKey === timelineItemKey) {
      this.ephemeral.delete(uid)
      this.invalidationEpochs.set(uid, (this.invalidationEpochs.get(uid) ?? 0) + 1)
      this.publish(uid, { items: [], loading: false, error: '' })
      this.refresh(uid)
    }
  }
  requestFocus(uid: string): void {
    this.focusUid = uid
    const state = this.get(uid)
    this.publish(uid, { ...state, focusRevision: (state.focusRevision ?? 0) + 1 })
  }
  takeFocus(uid: string): boolean {
    if (this.focusUid !== uid) return false
    this.focusUid = undefined; return true
  }
  dispose(): void { this.active = false; this.stop(); this.watchers.clear(); this.states.clear(); this.readAt.clear(); this.versions.clear(); this.ephemeral.clear(); this.invalidationEpochs.clear() }
  private publish(uid: string, state: RecordThoughtState) {
    this.states.set(uid, state)
    this.watchers.get(uid)?.listeners.forEach(listener => listener())
  }
  private queue(uids: string[]) {
    for (const uid of uids) if (this.watchers.has(uid) && !this.inFlightUids.has(uid)) this.pending.add(uid)
    if (!this.active || !this.pending.size || this.controller || this.batchTimer) return
    this.batchTimer = setTimeout(() => { this.batchTimer = undefined; void this.flush() }, 32)
  }
  private stop() {
    this.generation++; this.controller?.abort(); this.controller = undefined; this.inFlightUids.clear()
    clearTimeout(this.batchTimer); clearTimeout(this.pollTimer); this.batchTimer = undefined; this.pollTimer = undefined
    this.pending.clear()
    for (const [uid, state] of this.states) if (state.loading) this.publish(uid, { ...state, loading: false })
  }
  private schedulePoll() {
    clearTimeout(this.pollTimer)
    if (!this.active || !this.watchers.size) return
    const recent = [...this.watchers].filter(([uid, watch]) => this.ephemeral.has(uid) || this.get(uid).items.some(item => item.status === 'generating')
      || (!this.get(uid).items.length && watch.sentAt > Date.now() - 300_000)).map(([uid]) => uid)
    const delay = recent.length ? Math.min(30_000, 4_000 * 2 ** Math.min(this.failures, 3)) : 30_000
    this.pollTimer = setTimeout(() => { this.pollTimer = undefined; this.queue(recent.length ? recent : [...this.watchers.keys()]) }, delay)
  }
  private async flush() {
    if (!this.active || this.controller || !this.pending.size) return
    const uids = [...this.pending].filter(uid => this.watchers.has(uid)).slice(0, 50)
    if (!uids.length) return
    uids.forEach(uid => this.pending.delete(uid))
    const generation = this.generation, controller = new AbortController()
    this.controller = controller; this.inFlightUids = new Set(uids)
    const versions = new Map(uids.map(uid => [uid, this.versions.get(uid)]))
    const epochs = new Map(uids.map(uid => [uid, this.invalidationEpochs.get(uid)]))
    for (const uid of uids) this.publish(uid, { ...this.get(uid), loading: true, error: '' })
    try {
      const result = await this.read(this.scope, uids, controller.signal, uids.flatMap(uid => this.watchers.get(uid)?.actionRef ? [this.watchers.get(uid)!.actionRef!] : []))
      if (controller.signal.aborted || generation !== this.generation) return
      if (result.accountScope !== this.scope || !Array.isArray(result.items)) throw new Error('想法读取的账号不一致')
      this.failures = 0
      for (const uid of uids) {
        if (versions.get(uid) !== this.versions.get(uid) || epochs.get(uid) !== this.invalidationEpochs.get(uid) || this.pending.has(uid)) continue
        this.readAt.set(uid, Date.now())
        let items = result.items.filter(item => item.recordUid === uid && Number.isSafeInteger(item.sourceVersion) && item.sourceVersion!>0 && Number.isSafeInteger(item.currentSourceVersion) && item.currentSourceVersion===this.versions.get(uid) && item.sourceVersion!<=item.currentSourceVersion!)
        const ephemeral = this.ephemeral.get(uid)
        if (ephemeral && ephemeral.item.status==='generating' && ephemeral.item.sourceVersion===this.versions.get(uid) && !items.some(item => item.biz === ephemeral.item.biz) && Date.now() - ephemeral.at < 30_000) items = [...items, ephemeral.item]
        else this.ephemeral.delete(uid)
        this.publish(uid, { items, loaded: true, loading: false, error: '' })
      }
    } catch {
      if (!controller.signal.aborted) this.failures++
      if (!controller.signal.aborted && generation === this.generation) for (const uid of uids)
        this.publish(uid, { ...this.get(uid), loading: false, error: '想法暂时无法读取' })
    } finally {
      if (this.controller === controller) {
        this.controller = undefined; this.inFlightUids.clear()
        if (this.pending.size) this.queue([])
        else this.schedulePoll()
        // Keep only a bounded, memory-only history when moving between topics.
        for (const uid of this.states.keys()) if (this.states.size > 500 && !this.watchers.has(uid)) { this.states.delete(uid); this.readAt.delete(uid); this.versions.delete(uid); this.ephemeral.delete(uid); this.invalidationEpochs.delete(uid) }
      }
    }
  }
}
