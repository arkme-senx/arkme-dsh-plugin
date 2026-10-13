import type { DshAccountSession } from '../dsh-remote/account-session-types.js'

/** A scoped profile identifies a Home container, unlike the legacy shared `web`
 * profile. Runtime registration can change while that container stays the same.
 * Do not use titles, desktop labels or session IDs alone as identity. */
function containerSessionKey(row: DshAccountSession): string | undefined {
  if (!/^web:scope_[A-Za-z0-9_-]+$/.test(row.runtimeName)
    || !row.sessionRef || typeof row.workspaceRef !== 'string' || !row.desktopName
    // -1 is the native "no projection yet" value, including older ungrouped
    // sessions. Missing/invalid values do not provide comparable evidence.
    || !Number.isSafeInteger(row.projectionAsOfSeq) || row.projectionAsOfSeq! < -1
    || !Number.isFinite(row.updatedAt)) return
  return JSON.stringify([row.runtimeName, row.desktopName, row.workspaceRef, row.sessionRef])
}

function covers(current: DshAccountSession, copy: DshAccountSession): boolean {
  if (current.updatedAt < copy.updatedAt || current.origin !== copy.origin) return false
  // An advanced journal in the same container also covers its older snapshot,
  // including after a rename/archive. Never hide a source with newer history.
  if (current.projectionAsOfSeq! > copy.projectionAsOfSeq!) return true
  return current.projectionAsOfSeq === copy.projectionAsOfSeq
    && current.title === copy.title && current.blank === copy.blank && current.archived === copy.archived
}

/** Display-only reconciliation of a complete, single-account catalog. The
 * retained row keeps its real runtimeRef for every native action. No source
 * journal, backend record, or routing identity is rewritten. */
export function collapseAccountSessionCopies(rows: DshAccountSession[], previous: readonly DshAccountSession[] = []): DshAccountSession[] {
  const groups = new Map<string, DshAccountSession[]>()
  for (const row of rows) {
    const key = containerSessionKey(row)
    if (!key) continue
    const group = groups.get(key) ?? []
    group.push(row); groups.set(key, group)
  }
  const known = new Set(previous.map(row => JSON.stringify([row.runtimeRef, row.sessionRef])))
  const hidden = new Set<DshAccountSession>()
  for (const group of groups.values()) {
    if (group.length < 2) continue
    const live = group.filter(row => row.local || row.presence === 'online')
    // Two live sources could be independently used copies of a Home. Retain
    // both, and leave ambiguous/offline history alone until backend aliases exist.
    if (live.length > 1) continue
    const canonical = live[0] ?? [...group].sort((a, b) =>
      b.projectionAsOfSeq! - a.projectionAsOfSeq! || b.updatedAt - a.updatedAt
      || Number(known.has(JSON.stringify([b.runtimeRef, b.sessionRef]))) - Number(known.has(JSON.stringify([a.runtimeRef, a.sessionRef])))
      || (a.runtimeRef < b.runtimeRef ? -1 : a.runtimeRef > b.runtimeRef ? 1 : 0))[0]!
    for (const row of group) {
      if (row !== canonical && row.runtimeRef !== canonical.runtimeRef
        && !row.local && row.presence === 'offline' && covers(canonical, row)) hidden.add(row)
    }
  }
  return hidden.size ? rows.filter(row => !hidden.has(row)) : rows
}
