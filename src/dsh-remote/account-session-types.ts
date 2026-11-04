import type { DshRemoteTimelineNode } from './types.js'

export interface DshAccountSessionCursor { updated_at: number; session_ref: string; runtime_ref: string }
export interface DshAccountSession {
  canonicalIdentity?: boolean
  /** Canonical row revision, independent of observer/runtime connection state. */
  directoryVersion?: readonly [number, number]
  /** Hidden in the catalog; its revision prevents stale deltas from resurrecting it. */
  deleted?: boolean
  runtimeRef: string
  /** Server-verified retired read addresses for this same session. */
  previousRuntimeRefs?: string[]
  readableRuntimeRefs?: string[]
  contentRevision?: string
  historyRevision?: string
  /** Account-owned local alias; Runtime is absent until Host registration completes.
   * Server readiness selects the reader, not whether this identity is unique. */
  coveredLocalHistory?: { runtimeRef?: string; updatedAt: number; projectionAsOfSeq: number; source?: 'local' | 'cloud' }
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
  /** Registered in this Runtime; localAvailable separately describes physical access. */
  local: boolean
  /** Readable on this computer; independent of execution ownership. */
  localAvailable?: boolean
  localAccess?: LocalSessionAccess
  /** @deprecated Compatibility routing alias. This never proves a completed takeover. */
  localTakeover?: boolean
  executorRuntimeRef?: string
}
export interface LocalSessionAccess {
  runtimeRef: string
  sessionRef: string
  readHistory: boolean
  annotate: boolean
  execution: 'current' | 'peer' | 'unclaimed' | 'transferring'
  submit: 'direct' | 'route-or-handoff' | 'handoff'
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
export interface DshSessionHistoryCursor { source: 'host' | 'cloud' | 'cloud-raw' | 'cloud-format' | 'local'; before: number; through?: number }
export interface DshAccountSessionHistory {
  historySync?: import('../local-history-cloud-repair.js').HistorySyncStatus
  /** Verified same-user local journal; independent of cloud/source liveness. */
  local?: boolean
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
