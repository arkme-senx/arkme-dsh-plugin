import type { PeoplePage } from '../../people-contract.js'
import { PEOPLE_SOURCES } from '../../people-contract.js'
import { arkmeAuthStore } from '../auth-store.js'
import { RelationViewCache } from './relation-view-cache.js'

const storage = () => { try { return typeof window === 'undefined' ? undefined : window.localStorage } catch { return undefined } }
const allowed = (scope: string) => {
  const { auth, checked } = arkmeAuthStore.getSnapshot()
  return !checked || auth?.status === 'authenticated' && `${auth.environment}:${auth.userId}` === scope
}
// Contact action references last 30 minutes. Reading a cache never extends its lifetime.
export const peopleViewCache = new RelationViewCache(storage, Date.now, allowed, {
  prefix: 'dsh-arkme:people-view:v1:', maxAge: 25 * 60_000, maxEntry: 3_000_000, maxTotal: 8_000_000,
})
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
export function isPeoplePage(value: unknown): value is PeoplePage {
  return object(value) && PEOPLE_SOURCES.includes(value.source as PeoplePage['source'])
    && (value.nextCursor === undefined || typeof value.nextCursor === 'string') && Array.isArray(value.items)
    && value.items.every(row => {
      if (!object(row) || !['key', 'personKey', 'name'].every(key => typeof row[key] === 'string')) return false
      const relation = row.relation
      return row.source === value.source && typeof row.accountLinked === 'boolean' && typeof row.isSelf === 'boolean'
        && Array.isArray(row.aliases) && row.aliases.every(alias => typeof alias === 'string')
        && (relation === undefined || object(relation) && ['key', 'ref', 'title', 'summary'].every(key => typeof relation[key] === 'string'))
    })
}
export interface PeopleView { query: string; selected: string; filter: string; limit: number; listTop: number; detailTop: number }
export function isPeopleView(v: unknown): v is PeopleView {
  return object(v) && ['query', 'selected', 'filter'].every(key => typeof v[key] === 'string')
    && ['limit', 'listTop', 'detailTop'].every(key => typeof v[key] === 'number' && Number.isFinite(v[key]) && v[key] >= 0)
}
let previousScope: string | undefined
arkmeAuthStore.subscribe(() => {
  const { auth, checked } = arkmeAuthStore.getSnapshot()
  if (!checked || !auth) return
  const scope = auth.status === 'authenticated' ? `${auth.environment}:${auth.userId}` : ''
  if (!scope || previousScope !== undefined && previousScope !== scope) peopleViewCache.clear()
  previousScope = scope
})
