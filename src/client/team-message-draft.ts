import { rebaseTeamMentions } from './team-mentions.js'
import type { ArkmeComposerAttachment } from './composer-draft-store.js'
import type { ArkmeLocalFile } from '../file-transfer-contract.js'
import type { ArkmeUploadedAsset } from '../types.js'
import type { TeamContent, TeamMessage, TeamReplyTarget, TeamMention } from '../team-app-contract.js'

export type TeamDraft = { mentions?: TeamMention[]; attachments?: readonly ArkmeComposerAttachment[]; text: string; startedAtMillis?: number | undefined; assets: ArkmeUploadedAsset[]; localFiles?: ArkmeLocalFile[]; reply?: TeamReplyTarget; attempt?: { uid: string; reply?: TeamReplyTarget; content: TeamContent; expectedReplySeq: number; createdAt?: number; startedAtMillis?: number | undefined; fileRefs?: string[]; message?: TeamMessage; reason?: string } }

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
    ? validTeamDraftStart(draft.startedAtMillis) ?? now : undefined }
  if(mentions.length) next.mentions=mentions; else delete next.mentions
  return next
}
export function validTeamDraftStart(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined
}
