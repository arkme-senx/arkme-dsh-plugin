export interface TeamMessageDeletionResult {
  changedAtMillis: number
}

export interface ChatMessageActionResult extends TeamMessageDeletionResult {
  timelineItemKey: string
}
