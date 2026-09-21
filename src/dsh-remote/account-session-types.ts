import type { DshRemoteTimelineNode } from './types.js'

export interface DshAccountSessionCursor { updated_at: number; session_ref: string; runtime_ref: string }
export interface DshAccountSession {
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
}
export interface DshAccountSessionPage {
  contractVersion: 1
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
