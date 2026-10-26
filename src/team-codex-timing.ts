import type { TeamCodexTurnTiming } from './team-codex-contract.js'

const integer = (v: unknown): v is number => Number.isSafeInteger(v) && Number(v) >= 0
/** Shared by the local collector and the optional cloud reader. */
export function codexTurnTiming(value: unknown): TeamCodexTurnTiming | undefined {
  if (!value || typeof value !== 'object') return
  const t = value as Record<string, unknown>
  if (!integer(t.startedAt) || t.startedAt === 0 || !integer(t.observedAt) || t.observedAt < t.startedAt
    || !['working', 'finished', 'interrupted'].includes(String(t.state))) return
  if (t.state === 'working') {
    if (t.durationMs !== undefined || t.completedAt !== undefined) return
    return { startedAt: t.startedAt, observedAt: t.observedAt, state: 'working', ...(typeof t.live==='boolean'?{live:t.live}:{}) }
  }
  if (!integer(t.completedAt) || t.completedAt < t.startedAt || t.completedAt > t.observedAt
    || !integer(t.durationMs) || Math.abs(t.completedAt - t.startedAt - t.durationMs) > 2000) return
  return { startedAt: t.startedAt, completedAt: t.completedAt, durationMs: t.durationMs,
    state: t.state as 'finished' | 'interrupted', observedAt: t.observedAt }
}
