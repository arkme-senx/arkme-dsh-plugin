import { useState } from 'react'
import { arkmeMentionCandidateKey, type ArkmeComposerMentionTrigger, type ArkmeMentionCandidate } from './mention-candidates.js'

export interface MentionSuggestionEntry { key: string; candidate: ArkmeMentionCandidate; available: boolean }
export interface MentionSuggestionSession {
  key: string | undefined
  input: readonly ArkmeMentionCandidate[]
  rows: MentionSuggestionEntry[]
  activeKey: string | undefined
  height: number
  navigationRevision: number
}

export function reconcileMentionSuggestions(previous: MentionSuggestionSession | undefined, key: string | undefined, candidates: readonly ArkmeMentionCandidate[], loading: boolean): MentionSuggestionSession {
  const incoming = new Map(candidates.map(candidate => [arkmeMentionCandidateKey(candidate), candidate]))
  if (!previous || previous.key !== key || key === undefined) {
    return { key, input: candidates, rows: [...incoming].map(([key, candidate]) => ({ key, candidate, available: true })),
      activeKey: incoming.keys().next().value, height: loading ? 252 : Math.min(252, Math.max(96, incoming.size * 40 + 36)), navigationRevision: 0 }
  }
  const seen = new Set(previous.rows.map(row => row.key))
  // Keep removed rows as disabled placeholders until the query changes, so a
  // pointer never silently targets the person below a removed candidate.
  const rows = previous.rows.map(row => ({ ...row, candidate: incoming.get(row.key) ?? row.candidate, available: incoming.has(row.key) }))
  for (const [key, candidate] of incoming) if (!seen.has(key)) rows.push({ key, candidate, available: true })
  return { ...previous, input: candidates, rows,
    activeKey: previous.rows.length === 0 ? incoming.keys().next().value : previous.activeKey }
}

export function useMentionSuggestions(scope: string, trigger: ArkmeComposerMentionTrigger | undefined, candidates: readonly ArkmeMentionCandidate[], loading: boolean) {
  const key = trigger === undefined ? undefined : JSON.stringify([scope, trigger.startIndex, trigger.query])
  const [stored, setStored] = useState(() => reconcileMentionSuggestions(undefined, key, candidates, loading))
  let session = stored
  if (stored.key !== key || stored.input !== candidates) {
    session = reconcileMentionSuggestions(stored, key, candidates, loading)
    setStored(session)
  }
  const activeCandidate = session.rows.find(row => row.key === session.activeKey && row.available)?.candidate
  return { ...session, activeCandidate,
    activate: (key: string) => setStored(current => ({ ...current, activeKey: key })),
    move: (direction: 1 | -1) => setStored(current => {
      const available = current.rows.filter(row => row.available)
      const index = available.findIndex(row => row.key === current.activeKey)
      const next = index < 0 ? (direction === 1 ? 0 : available.length - 1) : (index + direction + available.length) % available.length
      return { ...current, activeKey: available[next]?.key, navigationRevision: current.navigationRevision + 1 }
    }),
  }
}
