/** Existing private-record thoughts. Reading never starts an AI generation. */
export interface ArkmeRecordThought {
  id: string
  recordUid: string
  content: string
  biz: 1 | 2
  /** Chat projections use the current protocol, normalized at the Host boundary. */
  scene?: 1 | 2 | 3 | 4 | 5
  visibility?: 'user' | 'members'
  status?: 'generating' | 'ready' | 'failed' | 'invalidated'
  generation?: number
  display?: ArkmeThoughtDisplay
}

export interface ArkmeThoughtDisplay {
  headline: string
  context?: string
  flowDirection?: string
  urgency?: string
  surface?: string
  underlying?: string
  emotion?: string
  expectation?: string
  lastAction?: string
  suggestedNext?: string
  tone?: string
  warnings: string[]
  suggestions: Array<{ style: string; items: string[] }>
}

export interface ArkmeRecordThoughts {
  accountScope: string
  items: ArkmeRecordThought[]
}

export interface ArkmeThoughtStreamUpdate {
  recordUid: string
  streamId: string
  biz: 1 | 2
  delta: string
  contentBytes: number
  phase: 'generating' | 'ready' | 'failed'
}
