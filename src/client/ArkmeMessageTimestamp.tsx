import { formatConversationDate } from './conversation-date-format.js'

/** Original message time, independent of edits and the sender header. */
export function ArkmeMessageTimestamp({ at }: { at: number }) {
  const date = new Date(at)
  if (!Number.isFinite(at) || at <= 0 || Number.isNaN(date.getTime())) return null
  const full = formatConversationDate(date, 'full')
  return <time className="arkme-message-timestamp" dateTime={date.toISOString()} title={full} aria-label={full}>
    {formatConversationDate(date, 'time')}
  </time>
}
