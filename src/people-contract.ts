import type { ExploreItem } from './explore-contract.js'

export const PEOPLE_SOURCES = ['relations', 'contacts', 'speakers'] as const
export type PeopleSource = typeof PEOPLE_SOURCES[number]
export const PEOPLE_SOURCE_LABELS: Record<PeopleSource, string> = { relations: '关系人物', contacts: '即我联系人', speakers: '录音说话人' }

/** An account-scoped read projection; personKey is never a write/authorization reference. */
export interface PersonFacet {
  key: string
  personKey: string
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
  chatRef?: string
}
export interface PeoplePage { source: PeopleSource; items: PersonFacet[] }
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
  for (const facet of facets) {
    if (!groups.has(facet.personKey)) groups.set(facet.personKey, new Map())
    groups.get(facet.personKey)!.set(facet.key, facet)
  }
  const priority: Record<PeopleSource, number> = { contacts: 2, speakers: 1, relations: 3 }
  return [...groups].map(([key, group]) => {
    const rank = (facet: PersonFacet) => facet.hasRemark || (facet.source === 'contacts' && facet.isSelf) ? 0 : priority[facet.source]
    const rows = [...group.values()].sort((a, b) => rank(a) - rank(b) || a.key.localeCompare(b.key))
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
