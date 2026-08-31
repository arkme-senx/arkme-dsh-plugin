import type { ArkmeSourceItem, ArkmeUploadedAsset } from '../types.js'
import type { ArkmeLocalFile } from '../file-transfer-contract.js'
import { arkmeEmojiById, type ArkmeEmoji } from './arkme-emoji.js'
import { arkmeSourceIdentityKey } from './source-identity.js'

export type ArkmeComposerAttachment = ({ asset: ArkmeUploadedAsset; localFile?: never } | { localFile: ArkmeLocalFile; asset?: never }) & { previewUrl?: string }

export function arkmeAttachmentId(item: ArkmeComposerAttachment): string { return item.localFile?.fileRef ?? item.asset!.fileAssetUid }
export function arkmeAttachmentMetadata(item: ArkmeComposerAttachment): ArkmeUploadedAsset | ArkmeLocalFile { return item.localFile ?? item.asset! }

export interface ArkmeComposerMention {
  mentionRef?: string
  botRef?: string
  all?: boolean
  displayName: string
  startIndex: number
  length: number
}

export interface ArkmeComposerEmoji {
  emojiId: string
  startIndex: number
}

export interface ArkmeComposerDraftSnapshot {
  text: string
  attachments: readonly ArkmeComposerAttachment[]
  mentions: readonly ArkmeComposerMention[]
  emojis: readonly ArkmeComposerEmoji[]
  fileSendIdentity?: { recordUid: string; relationUid: string; fingerprint: string }
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
  emojis: Object.freeze([]),
})

export const ARKME_COMPOSER_EMOJI_PLACEHOLDER = '\uFFFC'

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

export function reconcileArkmeComposerEmojis(
  previousText: string,
  nextText: string,
  emojis: readonly ArkmeComposerEmoji[],
): ArkmeComposerEmoji[] {
  if (previousText === nextText || emojis.length === 0) return [...emojis]
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
  return emojis.flatMap(emoji => {
    let nextStart = emoji.startIndex
    if (oldEnd <= emoji.startIndex) nextStart += delta
    else if (prefix > emoji.startIndex) nextStart = emoji.startIndex
    else return []
    if (nextStart < 0 || nextText[nextStart] !== ARKME_COMPOSER_EMOJI_PLACEHOLDER) return []
    return [{ ...emoji, startIndex: nextStart }]
  })
}

export interface ArkmeSerializedComposerDraft {
  text: string
  mentions: readonly ArkmeComposerMention[]
}

export function serializeArkmeComposerDraft(snapshot: ArkmeComposerDraftSnapshot): ArkmeSerializedComposerDraft {
  if (snapshot.emojis.length === 0) return { text: snapshot.text, mentions: snapshot.mentions }
  const emojis = [...snapshot.emojis].sort((left, right) => left.startIndex - right.startIndex)
  const buffer: string[] = []
  let cursor = 0
  let offsetDelta = 0
  const mentionDeltas = new Map<number, number>()
  for (const emoji of emojis) {
    if (emoji.startIndex < cursor || snapshot.text[emoji.startIndex] !== ARKME_COMPOSER_EMOJI_PLACEHOLDER) continue
    const token = arkmeEmojiById[emoji.emojiId]?.token
    if (token === undefined) continue
    buffer.push(snapshot.text.slice(cursor, emoji.startIndex), token)
    cursor = emoji.startIndex + 1
    offsetDelta += token.length - 1
    mentionDeltas.set(emoji.startIndex, offsetDelta)
  }
  buffer.push(snapshot.text.slice(cursor))
  const mentions = snapshot.mentions.map(mention => {
    let delta = 0
    for (const [emojiStart, nextDelta] of mentionDeltas) {
      if (emojiStart >= mention.startIndex) break
      delta = nextDelta
    }
    return { ...mention, startIndex: mention.startIndex + delta }
  })
  return { text: buffer.join(''), mentions }
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
  source: Pick<ArkmeSourceItem, 'kind' | 'sourceRef' | 'sourceKey' | 'topicHierarchyKey'> | undefined,
): string | undefined {
  if (!validUserId(userId) || source === undefined || source.sourceRef === '') return undefined
  return `${accountPrefix(userId)}source:${encodeURIComponent(source.kind)}:${encodeURIComponent(arkmeSourceIdentityKey(source))}`
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
  private readonly restoredKeys = new Set<string>()
  isRestored(key: string | undefined): boolean { return key !== undefined && this.restoredKeys.has(key) }
  beginFileSend(key: string): { recordUid: string; relationUid: string } {
    const draft = this.get(key)
    const fingerprint = JSON.stringify([serializeArkmeComposerDraft(draft), draft.attachments.map(arkmeAttachmentId)])
    const current = draft.fileSendIdentity
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    if (current?.fingerprint === fingerprint && uuid.test(current.recordUid) && uuid.test(current.relationUid)) return current
    const identity = { recordUid: crypto.randomUUID(), relationUid: crypto.randomUUID(), fingerprint }
    this.store(key, { ...draft, fileSendIdentity: identity })
    return identity
  }
  private static readonly storageKey = 'arkme-local-file-drafts-v1'

  constructor(private readonly storage?: Pick<Storage, 'getItem' | 'setItem'>) {
    try {
      const saved = JSON.parse(storage?.getItem(ArkmeComposerDraftStore.storageKey) ?? '[]') as unknown
      if (!Array.isArray(saved)) return
      for (const entry of saved.slice(0, 100)) {
        if (!Array.isArray(entry) || typeof entry[0] !== 'string' || !entry[0].startsWith('arkme-composer:')) continue
        const draft = entry[1] as ArkmeComposerDraftSnapshot
        if (typeof draft?.text !== 'string' || draft.text.length > 20_000 || !Array.isArray(draft.attachments) || !Array.isArray(draft.mentions) || !Array.isArray(draft.emojis)) continue
        const attachments = draft.attachments.filter(item => item.localFile !== undefined && /^arkme-file-v1\.[0-9a-f-]{36}$/.test(item.localFile.fileRef)
          && typeof item.localFile.fileName === 'string' && typeof item.localFile.mimeType === 'string' && Number.isSafeInteger(item.localFile.size))
          .slice(0, 9).map(item => ({ localFile: item.localFile! }))
        if (attachments.length > 0) { this.drafts.set(entry[0], { ...draft, attachments }); this.restoredKeys.add(entry[0]) }
      }
    } catch { /* An unavailable browser store must not prevent editing a local draft. */ }
  }

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
      emojis: reconcileArkmeComposerEmojis(current.text, text, current.emojis),
    })
  }

  insertEmoji(
    key: string | undefined,
    emoji: Pick<ArkmeEmoji, 'id' | 'token'>,
    selectionStart: number,
    selectionEnd = selectionStart,
    maxSerializedLength = 20_000,
  ): number | undefined {
    if (key === undefined || arkmeEmojiById[emoji.id] === undefined) return undefined
    const current = this.get(key)
    const start = Math.max(0, Math.min(current.text.length, Math.trunc(selectionStart)))
    const end = Math.max(start, Math.min(current.text.length, Math.trunc(selectionEnd)))
    const textWithoutSelection = current.text.slice(0, start) + current.text.slice(end)
    const mentions = reconcileArkmeComposerMentions(current.text, textWithoutSelection, current.mentions)
    const emojis = reconcileArkmeComposerEmojis(current.text, textWithoutSelection, current.emojis)
      .map(item => item.startIndex >= start ? { ...item, startIndex: item.startIndex + 1 } : item)
    emojis.push({ emojiId: emoji.id, startIndex: start })
    emojis.sort((left, right) => left.startIndex - right.startIndex)
    const next: ArkmeComposerDraftSnapshot = {
      text: textWithoutSelection.slice(0, start) + ARKME_COMPOSER_EMOJI_PLACEHOLDER + textWithoutSelection.slice(start),
      attachments: current.attachments,
      mentions: mentions.map(mention => mention.startIndex >= start
        ? { ...mention, startIndex: mention.startIndex + 1 }
        : mention),
      emojis,
    }
    if (serializeArkmeComposerDraft(next).text.length > maxSerializedLength) return undefined
    this.store(key, next)
    return start + 1
  }

  private insertMentionToken(
    key: string | undefined,
    mention: Pick<ArkmeComposerMention, 'mentionRef' | 'botRef' | 'all'>,
    displayName: string,
    selectionStart: number,
    selectionEnd = selectionStart,
  ): number | undefined {
    const normalizedDisplayName = displayName.trim()
    const normalizedMentionRef = mention.mentionRef?.trim()
    const normalizedBotRef = mention.botRef?.trim()
    if (key === undefined || normalizedDisplayName === '') return undefined
    if (mention.all !== true
      && (normalizedMentionRef === undefined || normalizedMentionRef === '')
      && (normalizedBotRef === undefined || normalizedBotRef === '')) return undefined
    const current = this.get(key)
    const start = Math.max(0, Math.min(current.text.length, Math.trunc(selectionStart)))
    const end = Math.max(start, Math.min(current.text.length, Math.trunc(selectionEnd)))
    const token = `@${normalizedDisplayName}`
    const inserted = `${token} `
    const text = current.text.slice(0, start) + inserted + current.text.slice(end)
    const mentions = reconcileArkmeComposerMentions(
      current.text,
      current.text.slice(0, start) + current.text.slice(end),
      current.mentions,
    ).map(mention => mention.startIndex >= start
      ? { ...mention, startIndex: mention.startIndex + inserted.length }
      : mention)
    if (mention.all === true) {
      mentions.push({ all: true, displayName: normalizedDisplayName, startIndex: start, length: token.length })
    } else if (normalizedBotRef !== undefined && normalizedBotRef !== '') {
      mentions.push({ botRef: normalizedBotRef, displayName: normalizedDisplayName, startIndex: start, length: token.length })
    } else {
      mentions.push({ mentionRef: normalizedMentionRef!, displayName: normalizedDisplayName, startIndex: start, length: token.length })
    }
    mentions.sort((left, right) => left.startIndex - right.startIndex)
    const emojis = reconcileArkmeComposerEmojis(
      current.text,
      current.text.slice(0, start) + current.text.slice(end),
      current.emojis,
    ).map(emoji => emoji.startIndex >= start
      ? { ...emoji, startIndex: emoji.startIndex + inserted.length }
      : emoji)
    this.store(key, { text, attachments: current.attachments, mentions, emojis })
    return start + inserted.length
  }

  insertMention(
    key: string | undefined,
    mentionRef: string,
    displayName: string,
    selectionStart: number,
    selectionEnd = selectionStart,
  ): number | undefined {
    return this.insertMentionToken(key, { mentionRef }, displayName, selectionStart, selectionEnd)
  }

  insertAllMention(
    key: string | undefined,
    selectionStart: number,
    selectionEnd = selectionStart,
  ): number | undefined {
    return this.insertMentionToken(key, { all: true }, '所有人', selectionStart, selectionEnd)
  }

  insertBotMention(
    key: string | undefined,
    botRef: string,
    displayName: string,
    selectionStart: number,
    selectionEnd = selectionStart,
  ): number | undefined {
    return this.insertMentionToken(key, { botRef }, displayName, selectionStart, selectionEnd)
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
    const retainedIds = new Set(retained.map(arkmeAttachmentId))
    for (const attachment of incoming) {
      const uid = arkmeAttachmentId(attachment)
      if (retained.length >= Math.max(0, maxAttachments) || retainedIds.has(uid)) {
        releaseArkmeComposerAttachment(attachment)
        continue
      }
      retainedIds.add(uid)
      retained.push(attachment)
    }
    if (retained.length === current.attachments.length) return
    this.store(key, { text: current.text, attachments: retained, mentions: current.mentions, emojis: current.emojis })
  }

  removeAttachment(key: string | undefined, fileAssetUid: string): void {
    if (key === undefined) return
    const current = this.drafts.get(key)
    if (current === undefined) return
    const removed = current.attachments.filter(item => arkmeAttachmentId(item) === fileAssetUid)
    if (removed.length === 0) return
    for (const attachment of removed) releaseArkmeComposerAttachment(attachment)
    this.storeOrDelete(key, {
      text: current.text,
      attachments: current.attachments.filter(item => arkmeAttachmentId(item) !== fileAssetUid),
      mentions: current.mentions,
      emojis: current.emojis,
    })
  }

  moveAttachment(key: string | undefined, index: number, destination: number): void {
    if (key === undefined) return
    const current = this.get(key)
    if (index < 0 || destination < 0 || index >= current.attachments.length || destination >= current.attachments.length || index === destination) return
    const attachments = [...current.attachments]
    const [item] = attachments.splice(index, 1); attachments.splice(destination, 0, item!)
    this.store(key, { ...current, attachments })
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
    const emojis = current.text === '' ? snapshot.emojis : current.emojis
    const merged = [...snapshot.attachments]
    const mergedIds = new Set(merged.map(arkmeAttachmentId))
    for (const attachment of current.attachments) {
      if (mergedIds.has(arkmeAttachmentId(attachment))) {
        releaseArkmeComposerAttachment(attachment)
      } else if (merged.length < 20) {
        mergedIds.add(arkmeAttachmentId(attachment))
        merged.push(attachment)
      } else {
        releaseArkmeComposerAttachment(attachment)
      }
    }
    this.storeOrDelete(key, { text, attachments: merged, mentions, emojis })
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
    if (snapshot.text === '' && snapshot.attachments.length === 0 && snapshot.mentions.length === 0 && snapshot.emojis.length === 0) {
      if (!this.drafts.delete(key)) return
      this.publish()
      return
    }
    this.store(key, snapshot)
  }

  private store(key: string, snapshot: ArkmeComposerDraftSnapshot): void {
    this.restoredKeys.delete(key)
    this.drafts.set(key, Object.freeze({
      text: snapshot.text,
      attachments: Object.freeze([...snapshot.attachments]),
      mentions: Object.freeze(snapshot.mentions.map(mention => Object.freeze({ ...mention }))),
      emojis: Object.freeze(snapshot.emojis.map(emoji => Object.freeze({ ...emoji }))),
      ...(snapshot.fileSendIdentity === undefined ? {} : { fileSendIdentity: Object.freeze({ ...snapshot.fileSendIdentity }) }),
    }))
    this.publish()
  }

  private publish(): void {
    try {
      // Only file drafts opt into persistence; existing Arko/text-only semantics stay unchanged.
      const entries = [...this.drafts].filter(([, draft]) => draft.attachments.some(item => item.localFile !== undefined))
        .map(([key, draft]) => [key, { ...draft, attachments: draft.attachments.flatMap(item => item.localFile === undefined ? [] : [{ localFile: item.localFile }]) }])
      this.storage?.setItem(ArkmeComposerDraftStore.storageKey, JSON.stringify(entries))
    } catch { /* The Host still owns staged bytes and accepted send tasks. */ }
    this.revision += 1
    for (const listener of this.listeners) listener()
  }
}

function browserDraftStorage(): Storage | undefined { try { return typeof window === 'undefined' ? undefined : window.localStorage } catch { return undefined } }
export const arkmeComposerDraftStore = new ArkmeComposerDraftStore(browserDraftStorage())
