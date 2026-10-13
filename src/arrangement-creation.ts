import type { ArkmeArrangementDateContext } from './types.js'

export function validArrangementDateContext(value: unknown): value is ArkmeArrangementDateContext {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const context = value as Partial<ArkmeArrangementDateContext>
  if (typeof context.defaultDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(context.defaultDate)
    || typeof context.timezone !== 'string' || !context.timezone || context.timezone.length > 100) return false
  const stamp = Date.parse(`${context.defaultDate}T00:00:00Z`)
  if (!Number.isFinite(stamp) || stamp < 0 || new Date(stamp).toISOString().slice(0, 10) !== context.defaultDate) return false
  try { new Intl.DateTimeFormat('en-US', { timeZone: context.timezone }); return true } catch { return false }
}
