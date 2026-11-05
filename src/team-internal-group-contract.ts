export interface TeamInternalGroupPerson { key: string; name: string }
export interface TeamInternalGroupPreview {
  state: 'preview'
  mode: 'create'|'link'
  label: string
  previewRef: string
  requestUid: string
  expiresAt: number
  add: TeamInternalGroupPerson[]
  remove: TeamInternalGroupPerson[]
  retainCount: number
  botCount: number
  owner: TeamInternalGroupPerson
  ownerChanged: boolean
  roleChanges: Array<TeamInternalGroupPerson & {before: 'owner'|'admin'|'member'; after: 'owner'|'admin'|'member'}>
  closePublicAccess: boolean
  requiresClientUpgrade: boolean
}
export type TeamInternalGroupResult = TeamInternalGroupPreview
  | {state: 'none'|'acknowledged'}
  | {state: 'unresolved'|'activating'|'ready'|'archived'|'rejected'; requestUid: string; label?: string}
export type TeamInternalGroupRequest = {teamRef: string} & (
  {action: 'prepare'; requestUid: string; mode: 'create'; name: string}
  | {action: 'prepare'; requestUid: string; mode: 'link'; sourceRef: string}
  | {action: 'confirm'; previewRef: string}
  | {action: 'recover'|'prepare-original'}
  | {action: 'ack'; requestUid: string})
export interface TeamInternalGroupPort {
  teamInternalGroup(request: TeamInternalGroupRequest, signal?: AbortSignal): Promise<TeamInternalGroupResult>
}

/** Host-only immutable command identity. Preview tokens can be refreshed safely
 * against this same UID; backend receipts prevent a second acceptance. */
export interface TeamInternalGroupAttempt {
  requestUid: string
  label: string
  input: {mode: 'create'|'link'; team_id: string; name?: string; chat_session_uid?: string}
}
