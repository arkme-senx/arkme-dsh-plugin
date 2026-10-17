import { useEffect, useMemo, useRef, useState } from 'react'
import { combinePeople, PEOPLE_SOURCES, type PeoplePage, type PeopleSource } from '../../people-contract.js'
import { callArkme } from '../api.js'

export type PeopleReadState = { page?: PeoplePage; loading: boolean; error?: string }
const empty = (): Record<PeopleSource, PeopleReadState> => ({ relations: { loading: true }, contacts: { loading: true }, speakers: { loading: true } })
let cacheScope = ''
const cache = new Map<PeopleSource, { page: PeoplePage; at: number }>()
export function clearPeopleDirectoryCache() { cache.clear() }

export function usePeopleDirectory(accountScope: string) {
  if (cacheScope !== accountScope) { cache.clear(); cacheScope = accountScope }
  const [reads, setReads] = useState(empty)
  const [revision, setRevision] = useState(0)
  const readScope = useRef(accountScope)
  useEffect(() => {
    const controller = new AbortController()
    const sameAccount = readScope.current === accountScope
    readScope.current = accountScope
    setReads(previous => sameAccount ? Object.fromEntries(PEOPLE_SOURCES.map(source => [source, { page: previous[source].page, loading: true }])) as typeof previous : empty())
    for (const source of PEOPLE_SOURCES) {
      const saved = cache.get(source)
      if (!revision && saved && Date.now() - saved.at < 30_000) {
        setReads(value => ({ ...value, [source]: { page: saved.page, loading: false } }))
        continue
      }
      void callArkme<PeoplePage>('people.list', { source }, controller.signal).then(page => {
        if (controller.signal.aborted) return
        if (page.source !== source || !Array.isArray(page.items)) throw new Error('人物目录响应不完整')
        if (cacheScope === accountScope) cache.set(source, { page, at: Date.now() })
        setReads(value => ({ ...value, [source]: { page, loading: false } }))
      }).catch(error => {
        if (!controller.signal.aborted) setReads(value => ({ ...value, [source]: { ...value[source], loading: false, error: error instanceof Error ? error.message : '人物目录读取失败' } }))
      })
    }
    return () => controller.abort()
  }, [accountScope, revision])
  const people = useMemo(() => combinePeople(PEOPLE_SOURCES.flatMap(source => reads[source].page?.items ?? [])), [reads])
  return { people, reads, refresh: () => setRevision(value => value + 1) }
}
