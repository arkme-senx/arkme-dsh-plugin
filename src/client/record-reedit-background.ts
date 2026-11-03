import type { ArkmeRecordReeditSubmissionView } from '../record-reedit-contract.js'

interface BackgroundEdit {
  accountKey: string
  sourceKey: string
  view: ArkmeRecordReeditSubmissionView
  phase: 'preparing' | 'accepted' | 'failed' | 'uncertain'
}

export class RecordReeditAcceptanceUnknown extends Error {}

/** Preparation survives conversation switches; durable Host receipts take over after acceptance. */
export class RecordReeditBackgroundQueue {
  private entries = new Map<string, BackgroundEdit>()
  private listeners = new Set<() => void>()
  private revision = 0
  private readonly storageKey = 'arkme.record-reedit.pending.v1'
  constructor(private readonly storage?: Pick<Storage, 'getItem' | 'setItem'>) {
    try {
      const saved: unknown = JSON.parse(storage?.getItem(this.storageKey) ?? '[]')
      if (Array.isArray(saved)) for (const value of saved.slice(0, 100)) {
        const entry = value as BackgroundEdit
        if (typeof entry?.accountKey !== 'string' || typeof entry.sourceKey !== 'string'
          || typeof entry.view?.itemUid !== 'string' || typeof entry.view.title !== 'string'
          || typeof entry.view.textContent !== 'string' || !Array.isArray(entry.view.attachments)) continue
        const uncertain = entry.phase !== 'failed'
        this.entries.set(this.key(entry.accountKey, entry.view.itemUid), { ...entry, phase: uncertain ? 'uncertain' : 'failed',
          view: { ...entry.view, state: uncertain ? 'uncertain' : 'failed', error: '保存被中断，修改内容已保留，请先核对结果' } })
      }
    } catch { /* An unavailable journal never supplies candidate content. */ }
  }
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener) } }
  getRevision = () => this.revision
  private key(accountKey: string, itemUid: string) { return JSON.stringify([accountKey, itemUid]) }
  private publish() { this.revision++; for (const listener of this.listeners) listener() }
  private persist() {
    this.storage?.setItem(this.storageKey, JSON.stringify([...this.entries.values()].filter(entry => entry.phase !== 'accepted')))
  }
  recovery(accountKey: string, itemUid: string) {
    const entry = this.entries.get(this.key(accountKey, itemUid))
    return entry?.phase === 'failed' ? entry.view : undefined
  }
  views(accountKey: string | undefined, sourceKey: string) {
    return [...this.entries.values()].filter(entry => entry.accountKey === accountKey && entry.sourceKey === sourceKey).map(entry => entry.view)
  }
  pending(accountKey: string, itemUid: string) {
    const view = this.entries.get(this.key(accountKey, itemUid))?.view
    return view && ['pending', 'committing', 'uncertain'].includes(view.state)
  }
  start(input: { accountKey: string; sourceKey: string; view: ArkmeRecordReeditSubmissionView;
    run(): Promise<ArkmeRecordReeditSubmissionView>; failed(error: unknown): void }) {
    const key = this.key(input.accountKey, input.view.itemUid)
    if (this.pending(input.accountKey, input.view.itemUid)) return false
    const entry: BackgroundEdit = { accountKey: input.accountKey, sourceKey: input.sourceKey, view: input.view, phase: 'preparing' }
    this.entries.set(key, entry)
    this.publish()
    void Promise.resolve().then(() => { this.persist(); return input.run() }).then(view => {
      if (this.entries.get(key) !== entry) return
      entry.view = view; entry.phase = 'accepted'; this.publish()
      try { this.persist() } catch { /* Host already owns a durable receipt. */ }
    }).catch(error => {
      if (this.entries.get(key) !== entry) return
      const unknown = error instanceof RecordReeditAcceptanceUnknown
      entry.view = { ...entry.view, state: unknown ? 'uncertain' : 'failed', error: error instanceof Error ? error.message : '保存失败，请恢复编辑后重试' }
      entry.phase = unknown ? 'uncertain' : 'failed'; this.publish()
      try { this.persist() } catch { /* Keep the recovery candidate in memory. */ }
      input.failed(error)
    })
    return true
  }
  observe(accountKey: string | undefined, sourceKey: string, receipts: readonly ArkmeRecordReeditSubmissionView[], reconciled = false) {
    let changed = false
    for (const [key, entry] of this.entries) {
      if (entry.accountKey !== accountKey || entry.sourceKey !== sourceKey) continue
      const matching = receipts.some(receipt => entry.phase === 'accepted' ? receipt.submissionId === entry.view.submissionId
        : entry.phase === 'uncertain' && receipt.itemUid === entry.view.itemUid && receipt.baseVersion === entry.view.baseVersion
          && receipt.textContent === entry.view.textContent && receipt.title === entry.view.title)
      if (matching) {
        this.entries.delete(key); changed = true
      } else if (reconciled && entry.phase === 'uncertain' && !receipts.some(receipt => receipt.itemUid === entry.view.itemUid)) {
        entry.phase = 'failed'
        entry.view = { ...entry.view, state: 'failed', error: '未发现已接收的保存任务，修改已保留，请恢复编辑后重试' }
        changed = true
      }
    }
    if (changed) { this.publish(); try { this.persist() } catch { /* Retain in memory. */ } }
  }
  forgetFailed(accountKey: string, itemUid: string) {
    const key = this.key(accountKey, itemUid)
    if (this.entries.get(key)?.phase === 'failed') {
      this.entries.delete(key); this.publish()
      try { this.persist() } catch { /* The editor now owns recovery. */ }
    }
  }
  clear() {
    this.entries.clear(); this.publish()
    try { this.persist() } catch { /* No retained candidates remain in memory. */ }
  }
}

function localJournal() { try { return typeof window === 'undefined' ? undefined : window.localStorage } catch { return undefined } }
export const recordReeditBackground = new RecordReeditBackgroundQueue(localJournal())
