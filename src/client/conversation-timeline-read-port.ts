import type { ArkmeTimelineCursor, ArkmeTimelinePage } from '../types.js'
import { callArkme } from './api.js'

/** Reading messages grants neither conversation activation nor read-ack authority. */
export interface ConversationTimelineReadPort {
  readPage(sourceRef: string, cursor: ArkmeTimelineCursor | undefined, signal: AbortSignal): Promise<ArkmeTimelinePage>
}

export const conversationTimelineReadPort: ConversationTimelineReadPort = {
  readPage: async (sourceRef, cursor, signal) => await callArkme<ArkmeTimelinePage>('source.timeline', {
    sourceRef, limit: 40, ...(cursor === undefined ? {} : { cursor }),
  }, signal),
}
