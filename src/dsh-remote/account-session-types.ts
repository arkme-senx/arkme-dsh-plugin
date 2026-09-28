import type { DshRemoteTimelineNode } from './types.js'

export interface DshAccountSessionCursor { updated_at: number; session_ref: string; runtime_ref: string }
export interface DshAccountSession {
  /** Canonical row revision, independent of observer/runtime connection state. */
  directoryVersion?: readonly [number, number]
  /** Hidden in the catalog; its revision prevents stale deltas from resurrecting it. */
  deleted?: boolean
  runtimeRef: string
  sessionRef: string
  workspaceRef: string
  workspaceName: string
  title: string
  updatedAt: number
  projectionAsOfSeq?: number
  capabilities: string[]
  running: boolean
  blank: boolean
  archived: boolean
  origin: string
  desktopName: string
  /** Relative to the controller's physical desktop, independent of the open source. */
  sameDesktop: boolean
  runtimeName: string
  presence: 'online' | 'offline' | 'unknown'
  local: boolean
  /** Verified against this Host's account-scoped journal, never desktop names. */
  localTakeover?: boolean
  executorRuntimeRef?: string
}
export interface DshAccountSessionPage {
  contractVersion: 1
  /** Opt-in authoritative tombstones are present, including their row versions. */
  includesDeleted?: boolean
  warning?: string
  items: DshAccountSession[]
  nextCursor?: DshAccountSessionCursor
  localRuntime?: { desktopName: string; runtimeName: string }
  localRuntimeRef?: string
}
export interface DshSessionHistoryCursor { source: 'host' | 'cloud'; before: number }
export interface DshAccountSessionHistory {
  nodes: DshRemoteTimelineNode[]
  nextCursor?: DshSessionHistoryCursor
  complete: boolean
  online: boolean
  warning?: string
}

export type DshAccountSessionOperation =
  | 'session.create' | 'session.rename' | 'session.archive' | 'session.prompt' | 'session.cancel'
  | 'session.model.get' | 'session.model.select' | 'model.list'
  | 'interaction.question.respond' | 'interaction.approval.respond'

export type DshAccountSessionCommandOptions = { runtimeRef: string; requestRef: string } & (
  | { operation: 'session.create'; sessionRef?: never; body: { workspace_ref: string; model_provider?: string; model_id?: string; reasoning_effort?: string } }
  | { operation: 'model.list'; sessionRef?: never; body?: Record<string, never> }
  | { operation: Exclude<DshAccountSessionOperation, 'session.create' | 'model.list'>; sessionRef: string; body?: Record<string, unknown> }
)
