import type { ArkmeArrangementEditResult, ArkmeArrangementItem, ArkmeArrangementReminderToggleResult } from '../types.js'
import { callArkme } from './api.js'

export async function toggleArrangementReminder(item: ArkmeArrangementItem, signal: AbortSignal, onApplied: (item: ArkmeArrangementItem) => void) {
  const enabled = !item.reminderEnabled
  if (enabled && (!item.remindAtMillis || item.remindAtMillis <= Date.now())) {
    if (item.version === undefined) throw new Error('Arrangement version unavailable')
    const now = new Date(), next = new Date(now)
    next.setHours(9, 0, 0, 0)
    if (next.getTime() <= now.getTime()) next.setDate(next.getDate() + 1)
    const edited = await callArkme<ArkmeArrangementEditResult>('arrangements.edit', {
      arrangementRef: item.arrangementRef, expectedVersion: item.version, remindAtMillis: next.getTime(),
    }, signal)
    if (signal.aborted) return
    if (edited.item.arrangementRef !== item.arrangementRef) throw new Error('Arrangement identity mismatch')
    onApplied(edited.item)
    if (edited.state !== 'applied') throw new Error('Arrangement version conflict')
  }
  const result = await callArkme<ArkmeArrangementReminderToggleResult>('arrangements.reminder-enabled', { arrangementRef: item.arrangementRef, enabled }, signal)
  if (signal.aborted) return
  if (!result.item || result.item.arrangementRef !== item.arrangementRef || result.item.reminderEnabled !== enabled) throw new Error('Reminder not confirmed')
  onApplied(result.item)
}
