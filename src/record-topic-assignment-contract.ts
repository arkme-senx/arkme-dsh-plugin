/** Move existing personal Records; never a forward, Chat relation or hierarchy operation. */
export interface ArkmeRecordTopicAssignmentInput {
  sourceRef: string
  assignmentRefs: readonly string[]
  /** Omitted only for release from a personal topic. */
  targetSourceRef?: string
}

export interface ArkmeRecordTopicAssignmentResult {
  movedRecordUids: string[]
  projectionRefreshPending: boolean
}
