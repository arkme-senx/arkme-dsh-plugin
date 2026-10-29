import type { TeamMessage } from '../team-app-contract.js'
import { quoteCanonicalText } from '../message-quote.js'
import { teamMessagePresentation } from './TeamMessageContent.js'

export function teamHistoryDate(at: number): string {
  const d = new Date(at)
  return Number.isFinite(at) && at > 0 && !Number.isNaN(d.getTime())
    ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` : ''
}

/** Keep the existing three-line history summary; preview metadata is not media authorization. */
export function teamHistoryText(message: TeamMessage): string {
  if (message.historyPreview) return message.content?.text_content?.trim() ?? ''
  return [quoteCanonicalText(teamMessagePresentation(message)), ...message.media.map(media => media.name)].filter(Boolean).join('\n')
}
