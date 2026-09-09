import type { SessionEvent } from '@deepseek-ai/dsh-session'

interface SessionEventSource {
  snapshotEvents?: () => readonly SessionEvent[]
  events?: readonly SessionEvent[]
}

export function readSessionEvents(session: SessionEventSource): readonly SessionEvent[] {
  if (typeof session.snapshotEvents === 'function') return session.snapshotEvents()
  if (Array.isArray(session.events)) return session.events
  throw new Error('当前 DSH 会话不支持读取事件，无法核验用户输入')
}
