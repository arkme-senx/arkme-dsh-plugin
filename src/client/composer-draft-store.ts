import type { ArkmeSourceItem, ArkmeUploadedAsset } from '../types.js'

export interface ArkmeComposerAttachment {
  asset: ArkmeUploadedAsset
  previewUrl?: string
}

export interface ArkmeComposerDraftSnapshot {
  text: string
  attachments: readonly ArkmeComposerAttachment[]
}

const EMPTY_DRAFT: ArkmeComposerDraftSnapshot = Object.freeze({ text: '', attachments: Object.freeze([]) })

export function arkmeComposerCanSend(text: string, attachmentCount: number, busy: boolean): boolean {
  return !busy && (text.trim() !== '' || attachmentCount > 0)
}

function validUserId(userId: number | undefined): userId is number {
  return userId !== undefined && Number.isSafeInteger(userId) && userId > 0
}

function accountPrefix(userId: number): string {
  return `arkme-composer:${String(userId)}:`
}

export function arkmeSourceComposerDraftKey(
  userId: number | undefined,
  source: Pick<ArkmeSourceItem, 'kind' | 'sourceRef'> | undefined,
): string | undefined {
  if (!validUserId(userId) || source === undefined || source.sourceRef === '') return undefined
  return `${accountPrefix(userId)}source:${encodeURIComponent(source.kind)}:${encodeURIComponent(source.sourceRef)}`
}

export function arkmeArkoComposerDraftKey(userId: number | undefined): string | undefined {
  return validUserId(userId) ? `${accountPrefix(userId)}arko` : undefined
}

export function releaseArkmeComposerAttachment(attachment: ArkmeComposerAttachment): void {
  if (attachment.previewUrl === undefined || typeof URL === 'undefined' || typeof URL.revokeObjectURL !== 'function') return
  URL.revokeObjectURL(attachment.previewUrl)
}

export function releaseArkmeComposerDraft(snapshot: ArkmeComposerDraftSnapshot): void {
  for (const attachment of snapshot.attachments) releaseArkmeComposerAttachment(attachment)
}

export class ArkmeComposerDraftStore {
  private readonly drafts = new Map<string, ArkmeComposerDraftSnapshot>()
  private readonly listeners = new Set<() => void>()
  private revision = 0

  readonly getRevision = (): number => this.revision

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  get(key: string | undefined): ArkmeComposerDraftSnapshot {
    return key === undefined ? EMPTY_DRAFT : this.drafts.get(key) ?? EMPTY_DRAFT
  }

  setText(key: string | undefined, text: string): void {
    if (key === undefined) return
    const current = this.get(key)
    if (current.text === text) return
    this.storeOrDelete(key, { text, attachments: current.attachments })
  }

  appendAttachments(
    key: string | undefined,
    incoming: readonly ArkmeComposerAttachment[],
    maxAttachments = 20,
  ): void {
    if (key === undefined) {
      for (const attachment of incoming) releaseArkmeComposerAttachment(attachment)
      return
    }
    const current = this.get(key)
    const retained = [...current.attachments]
    const retainedIds = new Set(retained.map(item => item.asset.fileAssetUid))
    for (const attachment of incoming) {
      const uid = attachment.asset.fileAssetUid
      if (retained.length >= Math.max(0, maxAttachments) || retainedIds.has(uid)) {
        releaseArkmeComposerAttachment(attachment)
        continue
      }
      retainedIds.add(uid)
      retained.push(attachment)
    }
    if (retained.length === current.attachments.length) return
    this.store(key, { text: current.text, attachments: retained })
  }

  removeAttachment(key: string | undefined, fileAssetUid: string): void {
    if (key === undefined) return
    const current = this.drafts.get(key)
    if (current === undefined) return
    const removed = current.attachments.filter(item => item.asset.fileAssetUid === fileAssetUid)
    if (removed.length === 0) return
    for (const attachment of removed) releaseArkmeComposerAttachment(attachment)
    this.storeOrDelete(key, {
      text: current.text,
      attachments: current.attachments.filter(item => item.asset.fileAssetUid !== fileAssetUid),
    })
  }

  /** Removes a draft without releasing its attachments so an in-flight send can own the snapshot. */
  take(key: string | undefined): ArkmeComposerDraftSnapshot {
    if (key === undefined) return EMPTY_DRAFT
    const current = this.drafts.get(key)
    if (current === undefined) return EMPTY_DRAFT
    this.drafts.delete(key)
    this.publish()
    return current
  }

  restore(key: string | undefined, snapshot: ArkmeComposerDraftSnapshot): void {
    if (key === undefined) {
      releaseArkmeComposerDraft(snapshot)
      return
    }
    const current = this.get(key)
    const text = current.text === '' ? snapshot.text : current.text
    const merged = [...snapshot.attachments]
    const mergedIds = new Set(merged.map(item => item.asset.fileAssetUid))
    for (const attachment of current.attachments) {
      if (mergedIds.has(attachment.asset.fileAssetUid)) {
        releaseArkmeComposerAttachment(attachment)
      } else if (merged.length < 20) {
        mergedIds.add(attachment.asset.fileAssetUid)
        merged.push(attachment)
      } else {
        releaseArkmeComposerAttachment(attachment)
      }
    }
    this.storeOrDelete(key, { text, attachments: merged })
  }

  clear(key: string | undefined): void {
    if (key === undefined) return
    const current = this.drafts.get(key)
    if (current === undefined) return
    this.drafts.delete(key)
    releaseArkmeComposerDraft(current)
    this.publish()
  }

  clearAccount(userId: number): void {
    if (!validUserId(userId)) return
    const prefix = accountPrefix(userId)
    let changed = false
    for (const [key, snapshot] of this.drafts) {
      if (!key.startsWith(prefix)) continue
      this.drafts.delete(key)
      releaseArkmeComposerDraft(snapshot)
      changed = true
    }
    if (changed) this.publish()
  }

  private storeOrDelete(key: string, snapshot: ArkmeComposerDraftSnapshot): void {
    if (snapshot.text === '' && snapshot.attachments.length === 0) {
      if (!this.drafts.delete(key)) return
      this.publish()
      return
    }
    this.store(key, snapshot)
  }

  private store(key: string, snapshot: ArkmeComposerDraftSnapshot): void {
    this.drafts.set(key, Object.freeze({
      text: snapshot.text,
      attachments: Object.freeze([...snapshot.attachments]),
    }))
    this.publish()
  }

  private publish(): void {
    this.revision += 1
    for (const listener of this.listeners) listener()
  }
}

export const arkmeComposerDraftStore = new ArkmeComposerDraftStore()
