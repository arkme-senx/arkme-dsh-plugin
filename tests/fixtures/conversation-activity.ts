import type { ConversationActivityResult } from '../../src/conversation-activity.js'
import { conversationWordsEnvelope, type ConversationWordsQuery } from '../../src/conversation-word-frequency.js'
export const query: ConversationWordsQuery = { accountScope: 'prod:7', sourceRef: 'signed', timezone: 'Asia/Shanghai', fromDate: null, toDate: null, sender: 'all' }
export const envelope = conversationWordsEnvelope(query, 'chat1', 'conversation_activity')
export const result: ConversationActivityResult = {
  id: 'a1', updatedAt: 1792108800000, fromAt: Date.parse('2026-10-13T09:15:00+08:00'), toAt: Date.parse('2026-10-14T20:15:00+08:00'),
  totalMessages: 15, systemMessages: 3, activeDays: 2, participants: 2,
  hourly: Array.from({ length: 24 }, (_, hour) => ({ hour, weekday: null, messages: hour === 9 ? 10 : hour === 20 ? 5 : 0, systemMessages: hour === 9 ? 2 : hour === 20 ? 1 : 0, participants: hour === 9 ? 2 : hour === 20 ? 1 : 0 })),
  weekly: Array.from({ length: 168 }, (_, i) => { const hour = i % 24, weekday = Math.floor(i / 24) + 1
    return { hour, weekday, messages: weekday === 2 && hour === 9 ? 10 : weekday === 3 && hour === 20 ? 5 : 0, systemMessages: weekday === 2 && hour === 9 ? 2 : weekday === 3 && hour === 20 ? 1 : 0, participants: weekday === 2 && hour === 9 ? 2 : weekday === 3 && hour === 20 ? 1 : 0 }
  }),
}
export const wireResult = { ...result, corpus: 'authorized_conversation_messages', time_basis: 'message_sent_at', message_types: 'all', deduplication: 'message_uid' }
export const wireState = { ...envelope, stale: false, progress: null, result: wireResult }
export const capability = { supported: true, schema_version: 1, scope: 'conversation_activity', full_history: true, all_message_types: true, historical_senders: true, sender_filter: true, source_navigation: true }
