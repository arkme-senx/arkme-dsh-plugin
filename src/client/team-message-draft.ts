import { rebaseTeamMentions } from './team-mentions.js'
import type { ArkmeComposerAttachment } from './composer-draft-store.js'
import type { ArkmeLocalFile } from '../file-transfer-contract.js'
import type { ArkmeUploadedAsset } from '../types.js'
import type { TeamContent, TeamMessage, TeamReplyTarget, TeamMention } from '../team-app-contract.js'

export type TeamDraft = { pendingEdit?: import('../team-snapshot-contract.js').TeamPendingEdit; mentions?: TeamMention[]; attachments?: readonly ArkmeComposerAttachment[]; text: string; startedAtMillis?: number | undefined; assets: ArkmeUploadedAsset[]; localFiles?: ArkmeLocalFile[]; reply?: TeamReplyTarget; attempt?: { metadataRef?: string; snapshotStatus?: string; uid: string; reply?: TeamReplyTarget; content: TeamContent; expectedReplySeq: number; createdAt?: number; startedAtMillis?: number | undefined; fileRefs?: string[]; message?: TeamMessage; reason?: string } }

export function persistTeamDraft(storage: Pick<Storage, 'setItem'>, key: string, draft: TeamDraft): void {
  const { attachments: _transient, ...persisted } = draft
  storage.setItem(key, JSON.stringify(persisted))
}

export function loadTeamDraft(storage: Pick<Storage, 'getItem'>, key: string): TeamDraft {
  try {
    const value: unknown = JSON.parse(storage.getItem(key) || 'null')
    if (value && typeof value === 'object' && 'text' in value && typeof value.text === 'string' && 'assets' in value && Array.isArray(value.assets)) return value as TeamDraft
  } catch {}
  return { text: '', assets: [] }
}

/** Start on actual content input, retain across blur/remount, reset only once a draft is empty. */
export function updateTeamDraftText(draft: TeamDraft, text: string, now = Date.now()): TeamDraft {
  const mentions=rebaseTeamMentions(draft.text,text,draft.mentions)
  const next = { ...draft, text, startedAtMillis: text || draft.assets.length || draft.localFiles?.length || draft.attachments?.length
    ? teamDraftStartForInput(draft,now) : undefined }
  if(mentions.length) next.mentions=mentions; else delete next.mentions
  return next
}
/** An undated restored draft stays unknown; only a new empty composer gets a clock. */
export function teamDraftStartForInput(draft: TeamDraft, now = Date.now()): number | undefined {
  return validTeamDraftStart(draft.startedAtMillis) ??
    (draft.text || draft.assets.length || draft.localFiles?.length || draft.attachments?.length ? undefined : now)
}
export function validTeamDraftStart(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined
}

export function restoreTeamDraftContent(original: TeamContent, next: Pick<TeamDraft,'text'|'mentions'>): Pick<TeamDraft,'text'|'mentions'> {
  const before=original.mentions ?? [], after=next.mentions ?? []
  const same=original.text_content===next.text && before.length===after.length && before.every((mention,index)=>{
    const other=after[index]!
    return mention.personRef===other.personRef && mention.displayName===other.displayName && mention.startIndex===other.startIndex && mention.length===other.length
  })
  const append=!!original.text_content && !!next.text && !same
  const text=append ? `${original.text_content}\n\n${next.text}` : original.text_content || next.text
  const mentions=append ? [...before,...after.map(mention=>({...mention,startIndex:mention.startIndex+original.text_content.length+2}))] : original.text_content ? before : after
  return {text,...(mentions.length ? {mentions} : {})}
}
