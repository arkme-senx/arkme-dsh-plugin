import type { ArkmeLocalFile } from '../file-transfer-contract.js'
import type { ArkmeUploadedAsset } from '../types.js'
import type { TeamContent, TeamMessage } from '../team-app-contract.js'

export type TeamDraft = { text: string; assets: ArkmeUploadedAsset[]; localFiles?: ArkmeLocalFile[]; attempt?: { uid: string; content: TeamContent; expectedReplySeq: number; createdAt?: number; fileRefs?: string[]; message?: TeamMessage; reason?: string } }

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
