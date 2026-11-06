import type { MessageUnderline } from './message-annotations.js'

/** Read-only historical rows retained for explicit per-item cloud import. */
export interface LocalTranscriptEntry { revision: number; original: string; text: string; marks: MessageUnderline[] }
