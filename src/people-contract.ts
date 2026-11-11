import type { ExploreItem } from './explore-contract.js'

export const PEOPLE_SOURCES = ['relations', 'contacts', 'speakers'] as const
export type PeopleSource = typeof PEOPLE_SOURCES[number]
export const PEOPLE_SOURCE_LABELS: Record<PeopleSource, string> = { relations: '关系人物', contacts: '即我联系人', speakers: '录音说话人' }

/** An account-scoped read projection; personKey is never a write/authorization reference. */
export interface PersonFacet {
  key: string
  personKey: string
  legacyPersonKey?: string
  source: PeopleSource
  name: string
  aliases: string[]
  hasRemark?: boolean
  accountLinked: boolean
  isSelf: boolean
  avatarRef?: string
  relation?: ExploreItem
  speakerRef?: string
  assignmentRef?: string
  identityKey?: string
  recordsRef?: string
  identityRef?: string
  identityRevision?: number
  personIdentityKey?: string
  personRef?: string
  chatRef?: string
}
export interface PeoplePage { source: PeopleSource; items: PersonFacet[]; nextCursor?: string; searchPending?: boolean }
export interface UnifiedPerson {
  key: string
  name: string
  aliases: string[]
  facets: PersonFacet[]
  sources: PeopleSource[]
  isSelf: boolean
  avatarRef?: string
}

/** Only a verified stable account/speaker/entity identity can combine rows, never a name. */
export function combinePeople(facets: readonly PersonFacet[]): UnifiedPerson[] {
  const groups = new Map<string, Map<string, PersonFacet>>()
  // Preserve verified legacy account joins when an entity acquires an explicit
  // canonical root. Conflicting roots never choose a winner implicitly.
  const canonical = new Map<string, string | null>()
  for (const facet of facets) if (facet.source === 'relations' && facet.legacyPersonKey && facet.legacyPersonKey !== facet.personKey) {
    const previous = canonical.get(facet.legacyPersonKey)
    canonical.set(facet.legacyPersonKey, previous === undefined || previous === facet.personKey ? facet.personKey : null)
  }
  for (const facet of facets) {
    const personKey = canonical.get(facet.personKey) ?? facet.personKey
    if (!groups.has(personKey)) groups.set(personKey, new Map())
    groups.get(personKey)!.set(facet.key, facet)
  }
  const priority: Record<PeopleSource, number> = { contacts: 2, speakers: 1, relations: 3 }
  return [...groups].map(([key, group]) => {
    const rank = (facet: PersonFacet) => facet.hasRemark || (facet.source === 'contacts' && facet.isSelf) ? 0 : priority[facet.source]
    const rows = [...group.values()].sort((a, b) => rank(a) - rank(b) || (a.name < b.name ? -1 : a.name > b.name ? 1 : a.key.localeCompare(b.key)))
    const name = rows[0]!.name
    const avatarRef = rows.find(x => x.avatarRef)?.avatarRef
    return { key, name, aliases: [...new Set(rows.flatMap(x => [x.name, ...x.aliases]))].filter(x => x && x !== name),
      facets: rows, sources: PEOPLE_SOURCES.filter(source => rows.some(x => x.source === source)), isSelf: rows.some(x => x.isSelf),
      ...(avatarRef ? { avatarRef } : {}) }
  }).sort((a, b) => Number(b.isSelf) - Number(a.isSelf)
    || Math.max(0, ...b.facets.map(x => x.relation?.date ?? 0)) - Math.max(0, ...a.facets.map(x => x.relation?.date ?? 0))
    || a.name.localeCompare(b.name, 'zh-CN') || a.key.localeCompare(b.key))
}

export function personMatches(person: UnifiedPerson, query: string): boolean {
  const needle = query.trim().toLocaleLowerCase('zh-CN')
  return !needle || [person.name, ...person.aliases].some(x => x.toLocaleLowerCase('zh-CN').includes(needle))
}

export interface PeopleIdentityChange { identityKey: string; namespace: string; beforeState: string; afterState: string }
export interface PeopleIdentityPreview { changes: PeopleIdentityChange[]; commandRef: string; changeCount: number; expiresAt: number }
export type PeopleIdentityProvenance = {kind: 'unknown'} | {kind: 'user_decision'; action: string; confirmedAt: number; confirmedBySelf: boolean}
export interface PeopleIdentityLink { provenance?: PeopleIdentityProvenance; identityKey: string; identityRef: string; namespace: string; splitRef?: string }
export interface PeopleIdentityReceipt { operationRef: string; state: string }

export interface PeopleIdentityImpact { recordingCount?: number; chatCount?: number; state: 'pending' | 'complete'; identityCount: number; relationRecordCount: number; unavailableRecordCount: number; names: Array<{name: string; target: boolean}>; displayChange?: {before: string[]; after: string[]}; nextCursor?: string }

export type PeopleIdentityCapabilities = {supported:false} | {supported:true;link:boolean;unlink:boolean;merge:boolean;split:boolean;undo:boolean;materialize:boolean;recordingBinding:boolean}
