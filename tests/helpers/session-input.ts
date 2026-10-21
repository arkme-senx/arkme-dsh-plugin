import type { UserMessage } from '@deepseek-ai/dsh-llm'
import type { Session } from '@deepseek-ai/dsh-session'

/**
 * Controlled input producer for tool tests, not an Agent loop implementation.
 * It records the public durable inbox vocabulary in a real Session so the
 * confirmation consumer observes arrival and consumption at distinct times.
 */
export function createSessionInput(session: Session) {
  const pending: Record<'next-step' | 'next-turn', UserMessage[]> = { 'next-step': [], 'next-turn': [] }
  return {
    append(target: 'next-step' | 'next-turn', message: UserMessage) {
      const start = pending[target].length
      session.append('agent/inbox/spliced', { target, start, removedCount: 0, inserted: [message] })
      pending[target].push(message)
    },
    claim(target: 'next-step' | 'next-turn', _turn: number) {
      const messages = pending[target].splice(0)
      session.append('agent/inbox/spliced', { target, start: 0, removedCount: messages.length, inserted: [] })
      return messages
    },
  }
}
