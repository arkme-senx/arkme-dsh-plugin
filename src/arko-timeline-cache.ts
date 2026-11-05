import type { ArkmeArkoTimelineCache } from './arko-timeline-contract.js'
export const ARKO_TIMELINE_CACHE_MAX_BYTES = 8 * 1024 * 1024
export const ARKO_TIMELINE_CACHE_MAX_MESSAGES = 2000
export const ARKO_TIMELINE_CACHE_MAX_INTERACTIONS = 400
/** Cache is disposable presentation, never pending-send evidence or an authority. */
export function parseArkoTimelineCache(value: unknown): ArkmeArkoTimelineCache | undefined {
  if (!value || typeof value !== 'object') return
  const raw = value as ArkmeArkoTimelineCache
  if (raw.schemaVersion !== 2 || !Number.isSafeInteger(raw.savedAtMillis) || raw.savedAtMillis <= 0
    || !Array.isArray(raw.messages) || !Array.isArray(raw.interactions) || raw.messages.length > 20000 || raw.interactions.length > 4000) return
  const validMessage = (x: ArkmeArkoTimelineCache['messages'][number]) => x && typeof x.id === 'string' && x.id.length <= 512
    && ['user','assistant','divider'].includes(x.role) && typeof x.text === 'string' && x.text.length <= 262144 && ['done','error','sending'].includes(x.status)
  const validInteraction = (x: ArkmeArkoTimelineCache['interactions'][number]) => x && typeof x.interactionKey === 'string' && x.interactionKey.length <= 256
    && typeof x.interactionRef === 'string' && x.interactionRef.length <= 4096 && typeof x.summary === 'string' && x.summary.length <= 2000
    && typeof x.sourceName === 'string' && x.sourceName.length <= 500 && ['self','chat'].includes(x.kind) && Number.isSafeInteger(x.occurredAtMillis) && x.occurredAtMillis > 0
  const allMessages = raw.messages.filter(validMessage), allInteractions = raw.interactions.filter(validInteraction)
  const messages = allMessages.slice(-ARKO_TIMELINE_CACHE_MAX_MESSAGES)
  const interactions = allInteractions.slice(-ARKO_TIMELINE_CACHE_MAX_INTERACTIONS)
  const messagesClipped = allMessages.length > messages.length, interactionsClipped = allInteractions.length > interactions.length
  const boundary = (values: unknown[]) => {
    const at = Math.min(...values.filter((x): x is number => Number.isSafeInteger(x) && Number(x) > 0 && Number(x) < Number.MAX_SAFE_INTEGER))
    return Number.isFinite(at) ? at + 1 : undefined
  }
  const historyBeforeMillis = messagesClipped ? boundary(messages.map(x => x.orderAtMillis ?? x.createdAtMillis)) : raw.historyBeforeMillis
  const interactionBeforeMillis = interactionsClipped ? boundary(interactions.map(x => x.occurredAtMillis)) : raw.interactionBeforeMillis
  if (messagesClipped && historyBeforeMillis === undefined || interactionsClipped && interactionBeforeMillis === undefined
    || [historyBeforeMillis, interactionBeforeMillis].some(x => x !== undefined && (!Number.isSafeInteger(x) || x <= 0))) return
  const result: ArkmeArkoTimelineCache = { schemaVersion: 2, savedAtMillis: raw.savedAtMillis, messages, interactions,
    ...(raw.session && Number.isSafeInteger(raw.session.sessionId) && raw.session.sessionId > 0 ? { session: raw.session } : {}),
    ...(!messagesClipped && typeof raw.historyCursor === 'string' && raw.historyCursor.length <= 16384 ? { historyCursor: raw.historyCursor } : {}),
    ...(!interactionsClipped && typeof raw.interactionCursor === 'string' && raw.interactionCursor.length <= 16384 ? { interactionCursor: raw.interactionCursor } : {}),
    ...(historyBeforeMillis === undefined ? {} : { historyBeforeMillis }),
    ...(interactionBeforeMillis === undefined ? {} : { interactionBeforeMillis }),
    ...(raw.viewport && Number.isFinite(raw.viewport.scrollTop) && raw.viewport.scrollTop >= 0 && typeof raw.viewport.followTail === 'boolean' ? { viewport: raw.viewport } : {}),
  }
  if (new TextEncoder().encode(JSON.stringify(result)).byteLength > ARKO_TIMELINE_CACHE_MAX_BYTES) return
  return result
}
