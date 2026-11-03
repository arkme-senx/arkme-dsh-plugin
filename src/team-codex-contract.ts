import type { ArkmeTeamMember } from './types.js'

/** Versioned, local-only events. No credentials, raw tool results or private reasoning. */
export type TeamCodexEventKind = 'UserPromptSubmit' | 'Progress' | 'Stop' | 'Interrupt'
export type TeamCodexConnectionStatus = 'pending' | 'active' | 'paused' | 'disconnected' | 'expired'
/** Navigation hint only. It grants neither cloud access nor upload permission. */
export interface TeamCodexEntryAvailability {
  userId: number
  visible: boolean
  checked: boolean
}
export interface TeamCodexQueuedRequest {
  id: string
  text: string
  createdAt: number
  delivery: 'queue' | 'send-now'
  state: 'queued' | 'pending' | 'sending' | 'unknown'
  paused: boolean
  attachmentCount: number
  truncated: boolean
}
/** A read-only, shape-validated desktop snapshot, not a Codex scheduling API. */
export interface TeamCodexQueueSnapshot {
  version: number
  availability: 'ready' | 'partial' | 'unavailable' | 'stale' | 'paused'
  reason: 'none' | 'unavailable' | 'unsupported' | 'wrong-home' | 'excluded' | 'paused' | 'ambiguous-owner'
  sourceAt: number | null
  checkedAt: number
  changedAt: number
  items: TeamCodexQueuedRequest[]
}
export interface TeamCodexTask {
  id: string
  title: string
  metadataVersion?: number
  summaryVersion?: number
  status: TeamCodexConnectionStatus
  state: 'waiting' | 'working' | 'finished' | 'interrupted'
  updatedAt: number
  eventCount: number
  member: ArkmeTeamMember
  /** Present for server-backed tasks; remote tasks never expose local mutation controls. */
  cloud?: { taskId: string; sourceId: string; sourceName: string; ownerRef: string; remote: boolean }
  classification?: {version:number;kind:'user'|'background';evidence:string}
  cloudBlocked?: boolean
  /** Absent only on the original, single-session trial records. */
  installationId?: string
  projectKey?: string
  projectName?: string
  cwd?: string
  branch?: string
  worktree?: string
  excluded?: boolean
  projectExcluded?: boolean
  queue?: TeamCodexQueueSnapshot
  queueSummary?: Omit<TeamCodexQueueSnapshot,'items'> & {count:number;waitingCount:number}
  /** Set only after checking the cloud contract and row ownership; never authorizes dispatch. */
  queueCloud?: 'ready' | 'unsupported' | 'unavailable' | 'private'
  currentInput?: { turnId: string; text: string; at: number }
  /** Local, account-checked source evidence. Absence does not mean another physical computer. */
  captureHealth?: { status: 'online' | 'buffering' | 'offline' | 'paused'; checkedAt: number; lastReceivedAt: number }
}
export interface TeamCodexInstallation {
  id: string
  name: string
  status: TeamCodexConnectionStatus
  configured: boolean
  updatedAt: number
  excludedProjects: { key: string; name: string }[]
}
export interface CodexTaskPosition { cursor?:string|undefined;after?:string|undefined;from?:string|undefined }
export interface CodexTaskPage {hasMore:boolean;hasNewer:boolean;firstCursor?:string|undefined;nextCursor?:string|undefined;previousCursor?:string|undefined}
export interface TeamCodexState {
  localOnly: boolean
  localTaskPage?:CodexTaskPage|undefined
  cloud?: { status: 'ready' | 'offline' | 'blocked' | 'unsupported'; pending: number; blocked: number; message?: string; hasMore?: boolean; hasNewer?:boolean; firstCursor?:string|undefined; nextCursor?:string|undefined; previousCursor?:string|undefined; page: number; uploadEnabled?: boolean; settingsPending?: boolean; sourceName?: string; reviewingTasks?: number }
  self: ArkmeTeamMember | null
  tasks: TeamCodexTask[]
  installations: TeamCodexInstallation[]
}
export interface TeamCodexInvitation {
  id: string
  instructions: string
  expiresAt: number
  /** Snapshot for this account and selected team, never an authorization grant. */
  context?: {
    account: { name: string; jotmoId: string }
    team: { name: string; jotmoId: string }
    cloudUpload: 'enabled' | 'disabled' | 'unsupported' | 'unavailable'
  }
}
/** Source-reported turn lifecycle, never derived from transport timestamps. */
export interface TeamCodexTurnTiming {
  startedAt: number
  completedAt?: number
  durationMs?: number
  state: 'working' | 'finished' | 'interrupted'
  observedAt: number
  /** Explicit source liveness at observedAt; absent on older cloud contracts. */
  live?: boolean
}
export interface TeamCodexProgress { id:string; text:string; at:number; truncated:boolean; sourceSequence?:number }
export interface TeamCodexEvent {
  eventId?: string
  version?: number
  sequence: number
  turnSequence?:number
  messageSequence?:number
  cursor?:string
  turnId: string
  kind: TeamCodexEventKind
  text: string
  at: number
  truncated: boolean
  /** Owner-local public progress; excluded from the cloud transport until its protocol supports it. */
  localProgress?: TeamCodexProgress[]
  timing?: TeamCodexTurnTiming
  /** Host-local, owner-only references. Never serialized into the team cloud journal. */
  privateImages?: { ref: string; width: number; height: number; state: 'ready' | 'pending' | 'unavailable';imageRef?:string }[]
  privateImagesUnavailable?:boolean
}
export type TeamCodexTaskSummary = Pick<TeamCodexTask, 'title'|'state'|'updatedAt'|'eventCount'|'metadataVersion'|'summaryVersion'|'projectKey'|'projectName'|'branch'> & Partial<Pick<TeamCodexTask,'status'|'excluded'|'projectExcluded'|'captureHealth'>>
export interface TeamCodexEventPage {
  taskSummary?: TeamCodexTaskSummary
  queue?: TeamCodexQueueSnapshot
  queueCloud?: TeamCodexTask['queueCloud']
  items: TeamCodexEvent[]
  nextBefore?: number
  latestCursor?:string
  firstCursor?:string
  nextCursor?: string
}

export const codexEventPhase=(kind:TeamCodexEventKind,messageSequence=0)=>kind==='UserPromptSubmit'&&messageSequence>0?1:({UserPromptSubmit:0,Progress:1,Interrupt:2,Stop:3})[kind]
export function compareCodexEvents(a:TeamCodexEvent,b:TeamCodexEvent):number {
 if(a.turnSequence!==undefined&&b.turnSequence!==undefined)return a.turnSequence-b.turnSequence||codexEventPhase(a.kind,a.messageSequence)-codexEventPhase(b.kind,b.messageSequence)||(a.messageSequence??0)-(b.messageSequence??0)||(a.eventId??'').localeCompare(b.eventId??'')
 return a.at-b.at||a.sequence-b.sequence
}
