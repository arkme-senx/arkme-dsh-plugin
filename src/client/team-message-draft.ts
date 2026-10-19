import type { ArkmeLocalFile } from '../file-transfer-contract.js'
import type { ArkmeUploadedAsset } from '../types.js'
import type { TeamContent, TeamMessage } from '../team-app-contract.js'

export type TeamReplyTarget = Pick<TeamMessage, 'ref' | 'key' | 'seq'> & { senderName: string; text: string }

export type TeamDraft = { text: string; replyTarget?: TeamReplyTarget | undefined; startedAtMillis?: number | undefined; assets: ArkmeUploadedAsset[]; localFiles?: ArkmeLocalFile[]; attempt?: { uid: string; replyTarget?: TeamReplyTarget | undefined; content: TeamContent; expectedReplySeq: number; createdAt?: number; startedAtMillis?: number | undefined; fileRefs?: string[]; message?: TeamMessage; reason?: string } }

export function persistTeamDraft(storage: Pick<Storage, 'setItem'>, key: string, draft: TeamDraft): void {
  storage.setItem(key, JSON.stringify(draft))
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
  return { ...draft, text, startedAtMillis: text || draft.assets.length || draft.localFiles?.length
    ? validTeamDraftStart(draft.startedAtMillis) ?? now : undefined }
}
export function validTeamDraftStart(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : undefined
}
