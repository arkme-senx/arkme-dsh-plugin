export const DSH_REMOTE_PROTOCOL = 'dsh.remote' as const
export const DSH_REMOTE_PROTOCOL_MAJOR = 1 as const
export const DSH_REMOTE_MAX_FRAME_BYTES = 60 * 1024
export const DSH_REMOTE_MAX_PAGE_ITEMS = 50
// The v4 contract keeps a 512 KiB logical snapshot-page ceiling, but the
// Realtime frame is the tighter boundary. Read projections therefore
// stop at the conservative inner-result budget below before this ceiling can be
// reached.
export const DSH_REMOTE_MAX_SNAPSHOT_BYTES = 512 * 1024
export const DSH_REMOTE_MAX_PAGE_RESULT_BYTES = 40 * 1024
export const DSH_REMOTE_MAX_TEXT_CODE_POINTS = 20_000
export const DSH_REMOTE_MAX_MODEL_OPTIONS = 100

export type DshRemoteCapability =
  | 'workspace.list'
  | 'session.list'
  | 'session.create'
  | 'session.create.model'
  | 'session.model.get'
  | 'session.model.select'
  | 'model.list'
  | 'session.history'
  | 'session.prompt'
  | 'session.prompt.queue'
  | 'session.prompt.steer'
  | 'session.cancel'
  | 'session.events'
  | 'interaction.question.respond'
  | 'interaction.approval.respond'

export type DshRemoteOperation =
  | 'capabilities.get'
  | 'snapshot.get'
  | 'workspace.list'
  | 'model.list'
  | 'session.model.get'
  | 'session.model.select'
  | 'session.list'
  | 'session.create'
  | 'session.history'
  | 'session.prompt'
  | 'session.cancel'
  | 'interaction.question.respond'
  | 'interaction.approval.respond'

export type DshRemoteRequestKind = 'request'
export type DshRemoteResponseStatus = 'accepted' | 'completed' | 'rejected' | 'duplicate'

export interface DshRemoteRequest {
  protocol: typeof DSH_REMOTE_PROTOCOL
  protocol_major: typeof DSH_REMOTE_PROTOCOL_MAJOR
  kind: DshRemoteRequestKind
  request_ref: string
  host_generation: number
  issued_at: number
  execute_before: number
  operation: DshRemoteOperation
  body: Record<string, unknown>
}

export interface DshRemoteResponse {
  protocol: typeof DSH_REMOTE_PROTOCOL
  protocol_major: typeof DSH_REMOTE_PROTOCOL_MAJOR
  kind: 'response'
  request_ref: string
  status: DshRemoteResponseStatus
  host_generation: number
  issued_at: number
  operation: DshRemoteOperation
  body: Record<string, unknown>
  session_seq?: number
  projection_as_of_seq?: number
  result?: unknown
  error?: {
    code: string
    message: string
    retryable: boolean
    trace_ref: string
  }
}

export interface DshRemoteRuntimeProjection {
  runtimeRef: string
  desktopRef?: string
  profileRef: string
  accountId: string
  hostGeneration: number
  capabilities: DshRemoteCapability[]
  updatedAtMillis: number
}

export interface DshRemoteStatus {
  contractVersion: 1
  available: boolean
  enabled: boolean
  connected: boolean
  accountId?: string
  desktopRef?: string
  runtimeRef?: string
  hostGeneration: number
  capabilities: DshRemoteCapability[]
  unavailableReason?: string
  revision: number
}

export interface DshRemoteTrustedEventMetadata {
  senderRole: 'host' | 'controller'
  runtimeRef: string
  acceptedAtMillis: number
  targetHostLeaseGeneration: number
  transportSequence?: number
}

export type DshRemoteRealtimePayload = Record<string, unknown>
export type DshRemotePublishDirection = 'request' | 'response' | 'snapshot' | 'event'

export interface DshRemoteRuntimeTarget {
  runtimeRef: string
  hostProfileRef: string
  hostClientRef: string
  hostLeaseGeneration: number
}

export interface DshRemoteControlPlane {
  registerDesktop(input: Record<string, unknown>, signal?: AbortSignal): Promise<Record<string, unknown>>
  registerRuntime(desktopRef: string, input: Record<string, unknown>, signal?: AbortSignal): Promise<Record<string, unknown>>
  syncWorkspaces(input: Record<string, unknown>, signal?: AbortSignal): Promise<Record<string, unknown>>
  syncSessions(input: Record<string, unknown>, signal?: AbortSignal): Promise<Record<string, unknown>>
  completeProjectionSnapshot(input: Record<string, unknown>, signal?: AbortSignal): Promise<Record<string, unknown>>
  appendSessionEvents(input: Record<string, unknown>, signal?: AbortSignal): Promise<Record<string, unknown>>
  sessionEventSyncStatuses(input: Record<string, unknown>, signal?: AbortSignal): Promise<Record<string, unknown>>
  completeSessionEventHistory(input: Record<string, unknown>, signal?: AbortSignal): Promise<Record<string, unknown>>
  /** Optional during rolling upgrades; raw HistoryEntry remains the fallback. */
  syncSessionTurns?(input: Record<string, unknown>, signal?: AbortSignal): Promise<Record<string, unknown>>
  /** Optional during rolling upgrades; raw HistoryEntry remains the fallback. */
  completeSessionTurnHistory?(input: Record<string, unknown>, signal?: AbortSignal): Promise<Record<string, unknown>>
}

export type DshRemoteTimelineNodeKind =
  | 'user'
  | 'steering'
  | 'context'
  | 'assistant'
  | 'tool'
  | 'command'
  | 'compaction'
  | 'retry'
  | 'turn_error'
  | 'max_tokens'
  | 'unknown'

export type DshRemotePresentationFormat = 'message' | 'content' | 'summary'

export type DshRemotePresentationTone = 'neutral' | 'muted' | 'error'

/** Host-owned render intent; consumers map layout without interpreting raw events. */
export interface DshRemoteNodePresentation {
  version: 1
  format: DshRemotePresentationFormat
  icon?: 'context' | 'think' | 'tool' | 'search' | 'fetch' | 'terminal' | 'read' | 'edit' | 'code' | 'retry' | 'error' | 'info' | 'command' | 'compact'
  title?: string
  summary?: string
  details?: string
  tone: DshRemotePresentationTone
  monospace?: boolean
}

export interface DshRemoteTimelineNode {
  node_ref: string
  kind: DshRemoteTimelineNodeKind
  ordinal: number
  anchor_seq: number
  time: number
  source_seq_start: number
  source_seq_end: number
  data: Record<string, unknown>
  presentation: DshRemoteNodePresentation
}

export interface DshRemoteTurnProjection {
  turn_ref: string
  start_seq: number
  end_seq: number
  status: 'completed' | 'interrupted' | 'error' | 'max_tokens'
  presentation_version: 1
  nodes: DshRemoteTimelineNode[]
}

export interface DshRemoteRealtimeTransport {
  subscribeDisconnect(listener: (error: Error) => void): () => void
  connect(input: { profileRef: string; clientRef: string; signal: AbortSignal }): Promise<void>
  disconnect(): Promise<void>
  registerHost(input: {
    runtimeRef: string
    capabilities: DshRemoteCapability[]
    signal: AbortSignal
  }): Promise<{ serviceLeaseGeneration: number }>
  unregisterHost(signal?: AbortSignal): Promise<void>
  subscribe(input: {
    target: DshRemoteRuntimeTarget
    afterSequence?: number
    onEvent: (payload: DshRemoteRealtimePayload, metadata: DshRemoteTrustedEventMetadata) => void
    signal: AbortSignal
  }): Promise<() => void>
  publish(input: {
    target: DshRemoteRuntimeTarget
    commandId: string
    direction: DshRemotePublishDirection
    payload: DshRemoteRealtimePayload
    signal: AbortSignal
  }): Promise<{ sequence: number }>
}

export interface DshRemoteWorkspaceView {
  workspaceId: string
  title: string
  path: string
  available: boolean
  sessionIds: string[]
}

export interface DshRemoteSessionSummary {
  sessionId: string
  workspaceId: string
  title?: string
  updatedAt: number
  running: boolean
  blank: boolean
  archived?: boolean
  origin?: 'subagent'
  parentSessionId?: string
  projectionAsOfSeq?: number
  /** Public DSH `goal` projection; absent only when the runtime omits it. */
  goal?: unknown
}

export interface DshRemoteModelOption {
  provider: string
  providerName: string
  model: string
  displayName: string
  description?: string
  reasoningEfforts?: DshRemoteReasoningEffortOption[]
  defaultReasoningEffort?: string
}

export interface DshRemoteReasoningEffortOption {
  id: string
  displayName: string
  description?: string
}

export interface DshRemoteModelCatalog {
  items: DshRemoteModelOption[]
  failedProviders: Array<{ provider: string; providerName: string }>
  truncated: boolean
  defaultSelection?: DshRemoteModelSelection
}

export interface DshRemoteModelSelection {
  provider: string
  model: string
  reasoningEffort?: string
}

export interface DshRemoteSnapshot {
  projectionAsOfMillis: number
  workspaces: DshRemoteWorkspaceView[]
  sessions: DshRemoteSessionSummary[]
  pendingInteractions: DshRemotePendingInteraction[]
  nextCursor?: string
}

export type DshRemotePendingInteraction =
  | {
      kind: 'question'
      interactionRpcRef: string
      sessionId: string
      questions: unknown[]
    }
  | {
      kind: 'approval'
      interactionRpcRef: string
      sessionId: string
      approvalId: string
      toolName: string
      reason?: string
      canAllowOnce: boolean
      operationSummary?: string
    }

export interface DshRemoteHostFacade {
  start(): Promise<void>
  stop(): Promise<void>
  getStatus(): DshRemoteStatus
  renameDesktop(displayName: string): Promise<DshRemoteStatus>
  subscribe(listener: (status: DshRemoteStatus) => void): () => void
}
