export interface WorldSoundSegment { text: string; speaker: string; offsetMillis: number; durationMillis: number; omittedBefore: boolean; audioUrl?: string }
export interface WorldSoundExcerpt { source: 'recording' | 'call'; revision: string; durationMillis: number; segments: WorldSoundSegment[] }
export type WorldSoundSelection = { kind: 'recording'; itemRefs: string[] } | { kind: 'call'; callRef: string; segmentIds: string[] }
export type WorldSoundRequest = { accountKey: string } & (
  | { action: 'capabilities' }
  | { action: 'prepare'; selection: WorldSoundSelection }
  | { action: 'publish'; draftRef: string; teamRef?: string; requestUid: string; confirmed: true }
  | { action: 'management'; recordRef: string; withdraw?: boolean }
)
export interface WorldSoundPrepared { draftRef: string; excerpt: WorldSoundExcerpt }
export interface WorldSoundReceipt { recordRef: string; checkStatus: number; publicRequested: boolean }
export type WorldSoundResponse<R extends WorldSoundRequest> = R extends {action:'prepare'} ? WorldSoundPrepared : R extends {action:'capabilities'} ? {version:1; recording:boolean; call:boolean} : WorldSoundReceipt

/** Backend-only selectors never cross the Host boundary in a public response. */
export interface WorldSoundOwnerSelection { source: 'recording' | 'call'; session_id: string; segments: unknown[] }
