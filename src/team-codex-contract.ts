import type { ArkmeTeamMember } from './types.js'

/** Versioned, local-only events. No credentials, transcripts, tool results or private reasoning. */
export type TeamCodexEventKind = 'UserPromptSubmit' | 'Stop' | 'Interrupt'
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
  status: TeamCodexConnectionStatus
  state: 'waiting' | 'working' | 'finished' | 'interrupted'
  updatedAt: number
  eventCount: number
  member: ArkmeTeamMember
  /** Present for server-backed tasks; remote tasks never expose local mutation controls. */
  cloud?: { taskId: string; sourceId: string; sourceName: string; ownerRef: string; remote: boolean }
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
  currentInput?: { turnId: string; text: string; at: number }
}
export interface TeamCodexInstallation {
  id: string
  name: string
  status: TeamCodexConnectionStatus
  configured: boolean
  updatedAt: number
  excludedProjects: { key: string; name: string }[]
}
export interface TeamCodexState {
  localOnly: boolean
  cloud?: { status: 'ready' | 'offline' | 'blocked' | 'unsupported'; pending: number; blocked: number; message?: string; hasMore?: boolean; page: number; uploadEnabled?: boolean; sourceName?: string }
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
export interface TeamCodexEvent {
  eventId?: string
  version?: number
  sequence: number
  turnId: string
  kind: TeamCodexEventKind
  text: string
  at: number
  truncated: boolean
}
export interface TeamCodexEventPage {
  items: TeamCodexEvent[]
  nextBefore?: number
  nextCursor?: string
}
