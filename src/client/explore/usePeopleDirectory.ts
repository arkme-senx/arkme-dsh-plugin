import { useEffect, useMemo, useState } from 'react'
import { combinePeople, PEOPLE_SOURCES, type PeoplePage, type PeopleSource, type PersonFacet } from '../../people-contract.js'
import { callArkme } from '../api.js'
import { isPeoplePage, peopleViewCache } from './people-view-cache.js'

export type PeopleReadState = { page?: PeoplePage; loading: boolean; error?: string }
type Reads = Record<PeopleSource, PeopleReadState>
const initial = (scope: string): Reads => Object.fromEntries(PEOPLE_SOURCES.map(source => {
  const page = peopleViewCache.read(scope, `directory:${source}`, isPeoplePage)?.value
  return [source, { ...(page ? { page } : {}), loading: true }]
})) as Reads
export function clearPeopleDirectoryCache() { peopleViewCache.clear() }
const merge = (old: PersonFacet[], next: PersonFacet[]) => [...new Map([...old, ...next].map(row => [row.key, row])).values()]

export function usePeopleDirectory(accountScope: string) {
  const [state, setState] = useState(() => ({ scope: accountScope, reads: initial(accountScope) }))
  const [revision, setRevision] = useState(0)
  useEffect(() => {
    const controller = new AbortController()
    const publish = (source: PeopleSource, value: PeopleReadState) => {
      if (!controller.signal.aborted) setState(previous => ({ scope: accountScope,
        reads: { ...(previous.scope === accountScope ? previous.reads : initial(accountScope)), [source]: value } }))
    }
    for (const source of PEOPLE_SOURCES) {
      const key = `directory:${source}`, saved = peopleViewCache.read(accountScope, key, isPeoplePage)
      if (!revision && saved && !saved.value.nextCursor && Date.now() - saved.at < 30_000) {
        publish(source, { page: saved.value, loading: false }); continue
      }
      let visible = saved?.value
      publish(source, { ...(visible ? { page: visible } : {}), loading: true })
      void (async () => {
        let cursor: string | undefined, fresh: PersonFacet[] = []
        const cursors = new Set<string>(), startedAt = Date.now()
        do {
          const page = await callArkme<PeoplePage>('people.list', { source, ...(cursor ? { cursor } : {}) }, controller.signal)
          if (controller.signal.aborted) return
          if (!isPeoplePage(page) || page.source !== source) throw new Error('人物目录响应不完整')
          fresh = merge(fresh, page.items)
          cursor = page.nextCursor
          if (cursor && (cursors.has(cursor) || cursors.size >= 2000)) throw new Error('人物目录分页未能继续，请重试')
          if (cursor) cursors.add(cursor)
          // A partial snapshot cannot prove deletion. Retain old rows until the refresh completes.
          visible = { source, items: cursor ? merge(saved?.value.items ?? [], fresh) : fresh, ...(cursor ? { nextCursor: cursor } : {}) }
          peopleViewCache.write(accountScope, key, visible, cursor ? saved?.at ?? startedAt : startedAt)
          publish(source, { page: visible, loading: !!cursor })
        } while (cursor && !controller.signal.aborted)
      })().catch(error => publish(source, { ...(visible ? { page: visible } : {}), loading: false,
        error: error instanceof Error ? error.message : '人物目录读取失败' }))
    }
    return () => controller.abort()
  }, [accountScope, revision])
  const reads = state.scope === accountScope ? state.reads : initial(accountScope)
  const people = useMemo(() => combinePeople(PEOPLE_SOURCES.flatMap(source => reads[source].page?.items ?? [])), [reads])
  return { people, reads, refresh: () => setRevision(value => value + 1) }
}
