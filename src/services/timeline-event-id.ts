import { createHmac } from 'node:crypto'

/** Shared identity for a Chat unified page and its confirmed native-message tail. */
export function chatTimelineEventId(key: string, userId: number, environment: string, sessionUid: string, eventId: string): string {
  return `chat-event:${createHmac('sha256', key).update(JSON.stringify([userId, environment, sessionUid, eventId])).digest('base64url')}`
}
