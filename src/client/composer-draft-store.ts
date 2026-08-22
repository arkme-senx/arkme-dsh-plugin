import type { ArkmeSourceItem, ArkmeUploadedAsset } from '../types.js'

export interface ArkmeComposerAttachment {
  asset: ArkmeUploadedAsset
  previewUrl?: string
}

export interface ArkmeComposerMention {
  memberRef: string
  displayName: string
  startIndex: number
  length: number
}

export interface ArkmeComposerDraftSnapshot {
  text: string
  attachments: readonly ArkmeComposerAttachment[]
  mentions: readonly ArkmeComposerMention[]
}

export type ArkmeComposerDeleteDirection = 'backward' | 'forward'

export interface ArkmeComposerAtomicDeletion {
  text: string
  caretIndex: number
}

const EMPTY_DRAFT: ArkmeComposerDraftSnapshot = Object.freeze({
  text: '',
  attachments: Object.freeze([]),
  mentions: Object.freeze([]),
})

export function reconcileArkmeComposerMentions(
  previousText: string,
  nextText: string,
  mentions: readonly ArkmeComposerMention[],
): ArkmeComposerMention[] {
  if (previousText === nextText || mentions.length === 0) return [...mentions]
  let prefix = 0
  const prefixLimit = Math.min(previousText.length, nextText.length)
  while (prefix < prefixLimit && previousText[prefix] === nextText[prefix]) prefix += 1
  let suffix = 0
  const suffixLimit = Math.min(previousText.length - prefix, nextText.length - prefix)
  while (suffix < suffixLimit
    && previousText[previousText.length - suffix - 1] === nextText[nextText.length - suffix - 1]) suffix += 1
  const oldEnd = previousText.length - suffix
  const newEnd = nextText.length - suffix
  const delta = newEnd - oldEnd
  return mentions.flatMap(mention => {
    const mentionEnd = mention.startIndex + mention.length
    let nextStart = mention.startIndex
    if (oldEnd <= mention.startIndex) nextStart += delta
    else if (prefix >= mentionEnd) nextStart = mention.startIndex
    else return []
    const token = `@${mention.displayName}`
    if (nextStart < 0 || nextText.slice(nextStart, nextStart + mention.length) !== token) return []
    return [{ ...mention, startIndex: nextStart }]
  })
}

function normalizedSelection(text: string, selectionStart: number, selectionEnd: number): [number, number] {
  const start = Math.max(0, Math.min(text.length, Math.trunc(selectionStart)))
  const end = Math.max(0, Math.min(text.length, Math.trunc(selectionEnd)))
  return start <= end ? [start, end] : [end, start]
}

/** Expands a native text deletion to complete mention ranges so mentions behave as atomic inline objects. */
export function arkmeComposerAtomicDeletion(
  text: string,
  mentions: readonly ArkmeComposerMention[],
  selectionStart: number,
  selectionEnd: number,
  direction: ArkmeComposerDeleteDirection,
): ArkmeComposerAtomicDeletion | undefined {
  const [start, end] = normalizedSelection(text, selectionStart, selectionEnd)
  const collapsed = start === end
  const affected = mentions.filter(mention => {
    const mentionStart = mention.startIndex
    const mentionEnd = mention.startIndex + mention.length
    if (!collapsed) return start < mentionEnd && end > mentionStart
    if (direction === 'backward') {
      return (start > mentionStart && start <= mentionEnd)
        || (start === mentionEnd + 1 && text[mentionEnd] === ' ')
    }
    return start >= mentionStart && start < mentionEnd
  })
  if (affected.length === 0) return undefined

  let deleteStart = collapsed ? Math.min(...affected.map(mention => mention.startIndex)) : start
  let deleteEnd = collapsed
    ? Math.max(...affected.map(mention => mention.startIndex + mention.length))
    : end
  for (const mention of affected) {
    deleteStart = Math.min(deleteStart, mention.startIndex)
    deleteEnd = Math.max(deleteEnd, mention.startIndex + mention.length)
  }
  if (text[deleteEnd] === ' ') deleteEnd += 1
  return {
    text: text.slice(0, deleteStart) + text.slice(deleteEnd),
    caretIndex: deleteStart,
  }
}

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
    this.storeOrDelete(key, {
      text,
      attachments: current.attachments,
      mentions: reconcileArkmeComposerMentions(current.text, text, current.mentions),
    })
  }

  insertMention(
    key: string | undefined,
    memberRef: string,
    displayName: string,
    selectionStart: number,
    selectionEnd = selectionStart,
  ): number | undefined {
    if (key === undefined || memberRef.trim() === '' || displayName.trim() === '') return undefined
    const current = this.get(key)
    const start = Math.max(0, Math.min(current.text.length, Math.trunc(selectionStart)))
    const end = Math.max(start, Math.min(current.text.length, Math.trunc(selectionEnd)))
    const token = `@${displayName.trim()}`
    const inserted = `${token} `
    const text = current.text.slice(0, start) + inserted + current.text.slice(end)
    const mentions = reconcileArkmeComposerMentions(
      current.text,
      current.text.slice(0, start) + current.text.slice(end),
      current.mentions,
    ).map(mention => mention.startIndex >= start
      ? { ...mention, startIndex: mention.startIndex + inserted.length }
      : mention)
    mentions.push({ memberRef: memberRef.trim(), displayName: displayName.trim(), startIndex: start, length: token.length })
    mentions.sort((left, right) => left.startIndex - right.startIndex)
    this.store(key, { text, attachments: current.attachments, mentions })
    return start + inserted.length
  }

  deleteMentionAtSelection(
    key: string | undefined,
    selectionStart: number,
    selectionEnd: number,
    direction: ArkmeComposerDeleteDirection,
  ): number | undefined {
    if (key === undefined) return undefined
    const current = this.get(key)
    const deletion = arkmeComposerAtomicDeletion(
      current.text,
      current.mentions,
      selectionStart,
      selectionEnd,
      direction,
    )
    if (deletion === undefined) return undefined
    this.setText(key, deletion.text)
    return deletion.caretIndex
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
    this.store(key, { text: current.text, attachments: retained, mentions: current.mentions })
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
      mentions: current.mentions,
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
    const mentions = current.text === '' ? snapshot.mentions : current.mentions
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
    this.storeOrDelete(key, { text, attachments: merged, mentions })
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
    if (snapshot.text === '' && snapshot.attachments.length === 0 && snapshot.mentions.length === 0) {
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
      mentions: Object.freeze(snapshot.mentions.map(mention => Object.freeze({ ...mention }))),
    }))
    this.publish()
  }

  private publish(): void {
    this.revision += 1
    for (const listener of this.listeners) listener()
  }
}

export const arkmeComposerDraftStore = new ArkmeComposerDraftStore()
