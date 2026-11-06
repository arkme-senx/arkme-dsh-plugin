/** Personal Team directory presentation; opaque refs never grant Team access. */
export interface TeamEntryReference { kind: 'folder' | 'conversation' | 'group'; ref: string }
export type TeamEntryAction = 'pin' | 'unpin' | 'dismiss' | 'restore'
export interface TeamEntryPreferenceSnapshot {
  folderKey?:string
  key: string; target: TeamEntryReference; accessible: boolean
  pinned: boolean; dismissed: boolean; version: number; activitySeq: number
}
export interface TeamEntryPreferencePage {
  schemaVersion: 1 | 2; items: TeamEntryPreferenceSnapshot[]; hasMore: boolean; nextCursor?: string
  syncError?: string; migrationNotice?: string
}
export interface TeamEntryPreferenceCommand {
  scope?: 'workspace'
  operationId: string
  changes: { target: TeamEntryReference; action: TeamEntryAction; expectedVersion: number }[]
}
export interface TeamEntryPreferencePort {
  listTeamEntryPreferences(cursor?: string, signal?: AbortSignal,scope?:'workspace'): Promise<TeamEntryPreferencePage>
  queryTeamEntryPreferences(entries: TeamEntryReference[], signal?: AbortSignal,scope?:'workspace'): Promise<TeamEntryPreferencePage>
  changeTeamEntryPreferences(command: TeamEntryPreferenceCommand, signal?: AbortSignal): Promise<TeamEntryPreferencePage>
}
