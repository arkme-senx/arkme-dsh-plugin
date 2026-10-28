/** Personal Team directory presentation; opaque refs never grant Team access. */
export interface TeamEntryReference { kind: 'folder' | 'conversation'; ref: string }
export type TeamEntryAction = 'pin' | 'unpin' | 'dismiss' | 'restore'
export interface TeamEntryPreferenceSnapshot {
  key: string; target: TeamEntryReference; accessible: boolean
  pinned: boolean; dismissed: boolean; version: number; activitySeq: number
}
export interface TeamEntryPreferencePage {
  schemaVersion: 1; items: TeamEntryPreferenceSnapshot[]; hasMore: boolean; nextCursor?: string
  syncError?: string; migrationNotice?: string
}
export interface TeamEntryPreferenceCommand {
  operationId: string
  changes: { target: TeamEntryReference; action: TeamEntryAction; expectedVersion: number }[]
}
export interface TeamEntryPreferencePort {
  listTeamEntryPreferences(cursor?: string, signal?: AbortSignal): Promise<TeamEntryPreferencePage>
  queryTeamEntryPreferences(entries: TeamEntryReference[], signal?: AbortSignal): Promise<TeamEntryPreferencePage>
  changeTeamEntryPreferences(command: TeamEntryPreferenceCommand, signal?: AbortSignal): Promise<TeamEntryPreferencePage>
}
