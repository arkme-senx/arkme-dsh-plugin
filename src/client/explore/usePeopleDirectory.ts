import { useEffect, useMemo, useRef, useState } from 'react'
import { combinePeople, PEOPLE_SOURCES, type PeoplePage, type PeopleSource, type PersonFacet } from '../../people-contract.js'
import { callArkme } from '../api.js'
import { isPeoplePage, peopleViewCache } from './people-view-cache.js'

export type PeopleReadState = { page?: PeoplePage; loading: boolean; error?: string }
type Reads = Record<PeopleSource, PeopleReadState>
const cacheKey = (source: PeopleSource, query: string) => `directory:${source}${query ? `:query:${query}` : ''}`
const initial = (scope: string, query: string): Reads => Object.fromEntries(PEOPLE_SOURCES.map(source => {
  const page = peopleViewCache.read(scope, cacheKey(source, query), isPeoplePage)?.value
  return [source, { ...(page ? { page } : {}), loading: true }]
})) as Reads
export function clearPeopleDirectoryCache() { peopleViewCache.clear() }
const merge = (old: PersonFacet[], next: PersonFacet[]) => [...new Map([...old, ...next].map(row => [row.key, row])).values()]

/** Each source publishes one bounded page; scrolling/search never drains the whole account. */
export function usePeopleDirectory(accountScope: string, query = '') {
  const key = `${accountScope}:${query}`
  const [state, setState] = useState(() => ({ key, reads: initial(accountScope, query) }))
  const [revision, setRevision] = useState(0)
  const more = useRef<() => void>(() => {})
  useEffect(() => {
    const controller = new AbortController()
    const current = initial(accountScope, query)
    const cursors = new Map<PeopleSource, Set<string>>()
    const active = new Set<PeopleSource>()
    const publish = (source: PeopleSource, value: PeopleReadState) => {
      current[source] = value
      if (!controller.signal.aborted) setState({ key, reads: { ...current } })
    }
    const read = async (source: PeopleSource, cursor?: string) => {
      if (active.has(source) || controller.signal.aborted) return
      active.add(source)
      const previous = current[source].page
      publish(source, { ...(previous ? { page: previous } : {}), loading: true })
      try {
        const page = await callArkme<PeoplePage>('people.list', { source, ...(query ? { query } : {}), ...(cursor ? { cursor } : {}) }, controller.signal)
        if (controller.signal.aborted) return
        if (!isPeoplePage(page) || page.source !== source) throw new Error('人物目录响应不完整')
        const seen = cursors.get(source) ?? new Set<string>()
        if (page.nextCursor && (page.nextCursor === cursor || seen.has(page.nextCursor))) throw new Error('人物目录分页已变化，请刷新后重试')
        if (cursor) seen.add(cursor)
        cursors.set(source, seen)
        const value = { ...page, items: cursor ? merge(previous?.items ?? [], page.items) : page.items }
        peopleViewCache.write(accountScope, cacheKey(source, query), value, Date.now())
        publish(source, { page: value, loading: false })
      } catch (error) {
        if (!controller.signal.aborted) publish(source, { ...(previous ? { page: previous } : {}), loading: false, error: error instanceof Error ? error.message : '人物目录读取失败' })
      } finally { active.delete(source) }
    }
    more.current = () => {
      for (const source of PEOPLE_SOURCES) {
        const row = current[source]
        if (row.page?.nextCursor && !row.loading) void read(source, row.page.nextCursor)
      }
    }
    for (const source of PEOPLE_SOURCES) {
      const saved = peopleViewCache.read(accountScope, cacheKey(source, query), isPeoplePage)
      if (!revision && saved && !saved.value.nextCursor && Date.now() - saved.at < 30_000) publish(source, { page: saved.value, loading: false })
      else void read(source)
    }
    return () => { controller.abort(); more.current = () => {} }
  }, [key, revision])
  const reads = state.key === key ? state.reads : initial(accountScope, query)
  const people = useMemo(() => combinePeople(PEOPLE_SOURCES.flatMap(source => reads[source].page?.items ?? [])), [reads])
  return { people, reads, hasMore: PEOPLE_SOURCES.some(source => !!reads[source].page?.nextCursor), loadMore: () => more.current(), refresh: () => setRevision(value => value + 1) }
}
