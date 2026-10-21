import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { PEOPLE_SOURCES, PEOPLE_SOURCE_LABELS, personMatches, type PersonFacet, type UnifiedPerson } from '../../people-contract.js'
import type { ExploreDetail, ExploreEvidence, ExploreSource } from '../../explore-contract.js'
import type { ArkmeOpenPrivateChatResult, ArkmeRecordingSpeakerMembers } from '../../types.js'
import { mergeExploreEvidence } from '../../explore-evidence.js'
import { callArkme } from '../api.js'
import { arkmeUi } from '../ui-controller.js'
import { ArkmeUserAvatar } from '../ArkmeAvatar.js'
import { ArkmeDetailShell } from '../ArkmeDetailShell.js'
import { ArkmeTimelineDetailDrawer } from '../ArkmeNoteDetails.js'
import { ExploreRecordingSource } from './ExploreSurface.js'
import { usePeopleDirectory, type PeopleReadState } from './usePeopleDirectory.js'
import { tr, arkmeIntlLocale } from '../locale.js'
import { isPeopleView, peopleViewCache } from './people-view-cache.js'

const errorText = (error: unknown) => error instanceof Error ? error.message : tr('读取失败，请重试')
const date = (value: number) => value > 0 ? new Intl.DateTimeFormat(arkmeIntlLocale(), { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).format(value) : ''

export function PeopleLoading({ reads, onRetry }: { reads: ReturnType<typeof usePeopleDirectory>['reads']; onRetry(): void }) {
  return <div className="people-loading">
    {PEOPLE_SOURCES.map(source => <span key={source} className="explore-muted" role={reads[source].loading ? 'status' : undefined}>
      {tr(PEOPLE_SOURCE_LABELS[source])} · {reads[source].page?.items.length ?? ''}{reads[source].loading ? ` ${tr('加载中…')}` : reads[source].error ? `${reads[source].page ? ' ' : ''}${tr(reads[source].page ? '暂未更新' : '暂不可用')}` : ''}
    </span>)}
    {PEOPLE_SOURCES.some(source => reads[source].error) && <button className="explore-source-link" onClick={onRetry}>{tr('重新读取')}</button>}
  </div>
}

export function PeopleSurface({ accountScope, onBack }: { accountScope: string; onBack(): void }) {
  return <PeopleAccountSurface key={accountScope} accountScope={accountScope} onBack={onBack}/>
}
function PeopleAccountSurface({ accountScope, onBack }: { accountScope: string; onBack(): void }) {
  const { people, reads, refresh } = usePeopleDirectory(accountScope)
  const [initial] = useState(() => peopleViewCache.read(accountScope, 'view', isPeopleView)?.value)
  const [query, setQuery] = useState(initial?.query ?? ''), [selected, setSelected] = useState(initial?.selected ?? ''), [limit, setLimit] = useState(initial?.limit ?? 50)
  const [filter, setFilter] = useState(initial?.filter ?? '')
  const listRoot = useRef<HTMLDivElement>(null), detailRoot = useRef<HTMLElement>(null), sentinel = useRef<HTMLDivElement>(null)
  const position = useRef({ listTop: initial?.listTop ?? 0, detailTop: initial?.detailTop ?? 0 })
  const view = useRef({ query, selected, filter, limit }); view.current = { query, selected, filter, limit }
  const restoring = useRef(true), detailRestoring = useRef(true)
  useEffect(() => {
    const save = () => peopleViewCache.write(accountScope, 'view', { ...view.current, ...position.current }, Date.now())
    window.addEventListener('pagehide', save)
    return () => { window.removeEventListener('pagehide', save); save() }
  }, [accountScope])
  const visible = useMemo(() => people.filter(person => personMatches(person, query) && (!filter || person.sources.includes(filter as PersonFacet['source']))), [people, query, filter])
  const person = people.find(x => x.key === selected)
  useLayoutEffect(() => {
    if (restoring.current) { restoring.current = false; if (listRoot.current) listRoot.current.scrollTop = position.current.listTop; return }
    setLimit(50); position.current.listTop = 0; if (listRoot.current) listRoot.current.scrollTop = 0
  }, [query, filter])
  useLayoutEffect(() => {
    if (!person || !detailRoot.current) return
    if (detailRestoring.current) { detailRoot.current.scrollTop = position.current.detailTop; detailRestoring.current = false }
  }, [person?.key])
  useEffect(() => {
    if (!sentinel.current || limit >= visible.length) return
    const observer = new IntersectionObserver(entries => { if (entries.some(x => x.isIntersecting)) setLimit(value => value + 50) }, { root: listRoot.current, rootMargin: '180px' })
    observer.observe(sentinel.current); return () => observer.disconnect()
  }, [limit, visible.length])
  return <section className="arkme-explore" aria-label={tr('统一人物档案')}>
    <header className="explore-header"><button className="explore-button" onClick={onBack}>← {tr('关系')}</button><h2>{tr('人物')}</h2><span className="explore-muted">{tr('已汇总')} {people.length}</span><button className="explore-button" style={{ marginLeft: 'auto' }} onClick={refresh}>{tr('刷新')}</button></header>
    <PeopleLoading reads={reads} onRetry={refresh}/>
    <div className="explore-workspace" data-selected={!!person}>
      <aside className="explore-list-pane" aria-label={tr('人物列表')}>
        <div className="explore-filters">{['', ...PEOPLE_SOURCES].map(value => <button key={value} className="explore-filter" aria-pressed={filter === value} onClick={() => setFilter(value)}>{tr(value ? PEOPLE_SOURCE_LABELS[value as PersonFacet['source']] : '全部')}</button>)}</div>
        <input className="explore-search" aria-label={tr('搜索人物')} placeholder={tr('搜索姓名、备注或别名')} value={query} onChange={event => setQuery(event.target.value)}/>
        <div className="explore-list" ref={listRoot} onScroll={event => { position.current.listTop = event.currentTarget.scrollTop }}>
          {visible.slice(0, limit).map(row => <button className="explore-row people-row" aria-current={row.key === selected} key={row.key} onClick={() => { if (row.key !== selected) { position.current.detailTop = 0; detailRestoring.current = true }; setSelected(row.key) }}>
            {row.avatarRef ? <ArkmeUserAvatar avatarRef={row.avatarRef} size={32} label={row.name}/> : <span className="people-avatar">{row.name.slice(0, 1)}</span>}
            <span className="people-row-copy"><span className="explore-row-title">{row.name}{row.isSelf ? ` · ${tr('我')}` : ''}</span><span className="explore-row-meta">{row.sources.map(source => tr(PEOPLE_SOURCE_LABELS[source])).join(' · ')}</span></span>
          </button>)}
          {!visible.length && <p className="explore-more">{tr(PEOPLE_SOURCES.some(source => reads[source].loading) ? '正在读取人物…' : '没有匹配的人物')}</p>}
          <div ref={sentinel} className="explore-more">{visible.length > limit ? tr('向下滚动继续加载') : ''}</div>
        </div>
      </aside>
      <main className="explore-detail" ref={detailRoot} onScroll={event => { position.current.detailTop = event.currentTarget.scrollTop }} key={person?.key ?? 'empty'}>
        {person ? <><button className="explore-mobile-back explore-button" onClick={() => setSelected('')}>{tr('返回列表')}</button><PersonProfile person={person} accountScope={accountScope} reads={reads}/></>
          : <div className="explore-empty">{tr('选择人物，查看联系人、录音身份和相关记录')}<span className="explore-muted">{tr('已明确关联同一账号的资料合并展示；同名人物仍分别保留。')}</span></div>}
      </main>
    </div>
  </section>
}

function PersonProfile({ person, accountScope, reads }: { person: UnifiedPerson; accountScope: string; reads: Record<PersonFacet['source'], PeopleReadState> }) {
  const [identities, setIdentities] = useState(false), [tab, setTab] = useState<'records' | 'speakers'>('records')
  const [opening, setOpening] = useState(false), [error, setError] = useState('')
  const request = useRef<AbortController>()
  useEffect(() => () => request.current?.abort(), [person.key, accountScope])
  const contact = person.facets.find(x => x.chatRef), speakers = person.facets.filter(x => x.speakerRef), relations = person.facets.filter(x => x.relation)
  const chat = async () => {
    if (!contact?.chatRef || opening) return
    const controller = new AbortController(); request.current = controller; setOpening(true); setError('')
    try { const result = await callArkme<ArkmeOpenPrivateChatResult>('people.open-chat', { ref: contact.chatRef }, controller.signal); if (!controller.signal.aborted) arkmeUi.selectSource(result.source) }
    catch (e) { if (!controller.signal.aborted) setError(errorText(e)) }
    finally { if (!controller.signal.aborted) setOpening(false) }
  }
  return <>
    <h1>{person.name}{person.isSelf ? ` · ${tr('我')}` : ''}</h1>
    <div className="explore-muted">{person.sources.map(source => tr(PEOPLE_SOURCE_LABELS[source])).join(' · ')}</div>
    {!!person.aliases.length && <div className="explore-muted">{tr('其他称呼')}：{person.aliases.join('、')}</div>}
    <div className="explore-detail-actions">
      {contact && <button className="explore-button" disabled={opening} onClick={() => void chat()}>{tr(opening ? '正在打开…' : '发消息')}</button>}
      {!!speakers.length && <button className="explore-button" onClick={() => setTab('speakers')}>{tr('查看录音')}</button>}
      <button className="explore-button" onClick={() => setIdentities(true)}>{tr('关联身份')}</button>
    </div>
    {error && <p role="alert" className="explore-error">{error}</p>}
    {[...new Set(relations.map(x => x.relation!.summary).filter(Boolean))].map(summary => <p className="explore-detail-summary" key={summary}>{summary}</p>)}
    <div className="explore-filters people-tabs">
      <button className="explore-filter" aria-pressed={tab === 'records'} onClick={() => setTab('records')}>{tr('提及与相关记录')}</button>
      <button className="explore-filter" aria-pressed={tab === 'speakers'} onClick={() => setTab('speakers')}>{tr('录音身份')}</button>
    </div>
    {tab === 'records' ? <PersonRecords accountScope={accountScope} relations={relations} loading={reads.relations.loading} unavailable={!!reads.relations.error}/>
      : <>{speakers.map(facet => <PersonSpeaker key={facet.key} facet={facet}/>)}{!speakers.length && <p className="explore-muted">{tr(reads.speakers.loading ? '正在读取录音身份…' : reads.speakers.error ? '录音身份暂不可用，请重试' : '暂无已明确关联的录音身份。同名说话人需要确认后才能归入。')}</p>}</>}
    {identities && <ArkmeDetailShell title={tr('关联身份')} label={tr('关联身份')} onClose={() => setIdentities(false)}><div className="arkme-explore-dialog">
      {person.facets.map(facet => <div className="people-identity" key={facet.key}><strong>{facet.name}</strong><span className="explore-muted">{tr(PEOPLE_SOURCE_LABELS[facet.source])} · {tr(facet.accountLinked ? '已有账号关联' : '独立身份')}</span></div>)}
      <p className="explore-muted">{tr('以上为已保存身份的汇总。新增关联、解除关联和合并撤销尚待后端接通；同名记录不会自动合并。')}</p>
    </div></ArkmeDetailShell>}
  </>
}

function PersonSpeaker({ facet }: { facet: PersonFacet }) {
  const [value, setValue] = useState<ArkmeRecordingSpeakerMembers>(), [error, setError] = useState(''), [revision, setRevision] = useState(0)
  useEffect(() => { const c = new AbortController(); setError('')
    void callArkme<ArkmeRecordingSpeakerMembers>('recordings.speaker.members', { speakerRef: facet.speakerRef }, c.signal).then(result => { if (!c.signal.aborted) setValue(result) }).catch(e => { if (!c.signal.aborted) setError(errorText(e)) })
    return () => c.abort()
  }, [facet.speakerRef, revision])
  return <section className="explore-evidence"><strong>{facet.name}</strong>
    {error ? <p className="explore-error" role="alert">{error} <button className="explore-source-link" onClick={() => setRevision(x => x + 1)}>{tr('重试')}</button></p>
      : !value ? <p className="explore-muted" role="status">{tr('正在读取录音出现记录…')}</p>
      : value.state !== 'fresh' ? <p className="explore-muted">{tr(value.state === 'failed' ? '录音出现记录读取失败' : value.state === 'stale' ? '录音出现记录待更新' : '录音出现记录仍在整理')} <button className="explore-source-link" onClick={() => setRevision(x => x + 1)}>{tr('刷新')}</button></p>
      : <><p className="explore-muted">{tr('出现')} {value.dayCount} {tr('天')} · {value.items.length} {tr('个已关联的识别说话人')}{value.lastSeenAt > 0 ? ` · ${tr('最近')} ${date(value.lastSeenAt)}` : ''}</p>
        {value.lastSeenAt > 0 && <button className="explore-source-link" onClick={() => { const day = new Date(value.lastSeenAt); day.setHours(0, 0, 0, 0); arkmeUi.showRecordingTarget(day.getTime(), value.lastSeenAt) }}>{tr('打开最近出现的录音日期')} ↗</button>}</>}
  </section>
}

type RecordRead = { facet: PersonFacet; items: ExploreEvidence[]; nextCursor?: string | undefined; firstKeys: string[]; readAt: number; cacheAt: number; loading: boolean; retryCursor?: string | undefined; error?: string | undefined }
const isRecords = (v: unknown): v is RecordRead => {
  const row = v as RecordRead | undefined
  return !!row && Array.isArray(row.items) && row.items.every(item => typeof item.key === 'string' && typeof item.text === 'string')
    && Array.isArray(row.firstKeys) && row.firstKeys.every(key => typeof key === 'string') && Number.isFinite(row.readAt) && Number.isFinite(row.cacheAt)
}
function PersonRecords({ accountScope, relations, loading, unavailable }: { accountScope: string; relations: PersonFacet[]; loading: boolean; unavailable: boolean }) {
  const restore = (facet: PersonFacet): RecordRead => ({ ...(peopleViewCache.read(accountScope, `records:${facet.key}`, isRecords)?.value
    ?? { items: [], firstKeys: [], readAt: 0, cacheAt: 0 }), facet, loading: false, error: undefined })
  const [rows, setRows] = useState<RecordRead[]>(() => relations.map(restore)), [source, setSource] = useState<ExploreSource>(), [original, setOriginal] = useState(false)
  const rowsRef = useRef(rows); rowsRef.current = rows
  const [opening, setOpening] = useState(''), [error, setError] = useState('')
  const controller = useRef<AbortController>(), sourceRequest = useRef<AbortController>()
  const moreSentinel = useRef<HTMLDivElement>(null)
  const inFlight = useRef(new Map<string, AbortSignal>())
  const refs = relations.map(x => `${x.key}:${x.relation!.date}:${x.relation!.count ?? ''}`).join('|'), latest = useRef(relations); latest.current = relations
  const read = async (facet: PersonFacet, signal: AbortSignal, cursor?: string) => {
    const previousRequest = inFlight.current.get(facet.key)
    if (signal.aborted || (previousRequest && !previousRequest.aborted)) return
    inFlight.current.set(facet.key, signal)
    setRows(previous => previous.map(x => x.facet.key === facet.key ? { ...x, loading: true, error: undefined } : x))
    try { const currentFacet = latest.current.find(x => x.key === facet.key) ?? facet
      const value = await callArkme<ExploreDetail>('explore.detail', { ref: currentFacet.relation!.ref, part: 'records', ...(cursor ? { cursor } : {}) }, signal)
      if (!signal.aborted) setRows(previous => previous.map(x => {
        if (x.facet.key !== facet.key) return x
        const tail = !cursor && value.nextCursor ? x.items.filter(item => !x.firstKeys.includes(item.key)) : []
        const now = Date.now()
        return { facet: currentFacet, items: cursor ? mergeExploreEvidence(x.items, value.evidence) : mergeExploreEvidence(value.evidence, tail),
          firstKeys: cursor ? x.firstKeys : value.evidence.map(item => item.key), readAt: cursor ? x.readAt : now,
          cacheAt: cursor || tail.length ? x.cacheAt || now : now,
          nextCursor: tail.length ? x.nextCursor ?? value.nextCursor : value.nextCursor, loading: false }
      }))
    } catch (e) { if (!signal.aborted) setRows(previous => previous.map(x => x.facet.key === facet.key ? { ...x, loading: false, error: errorText(e), retryCursor: cursor } : x)) }
    finally { if (inFlight.current.get(facet.key) === signal) inFlight.current.delete(facet.key) }
  }
  useEffect(() => {
    const c = new AbortController(); controller.current = c
    const retained = latest.current.map(facet => {
      const previous = rowsRef.current.find(row => row.facet.key === facet.key) ?? restore(facet)
      const changed = previous.facet.relation?.date !== facet.relation?.date || previous.facet.relation?.count !== facet.relation?.count
      return { ...previous, facet, loading: false, readAt: changed ? 0 : previous.readAt }
    })
    const pending = retained.filter(row => !row.readAt || Date.now() - row.readAt > 30_000).map(row => row.facet)
    setRows(retained)
    // Bound concurrency while publishing every completed entity's records independently.
    const worker = async () => { while (pending.length && !c.signal.aborted) await read(pending.shift()!, c.signal) }
    const workers = Math.min(3, pending.length)
    for (let i = 0; i < workers; i++) void worker()
    return () => { c.abort(); sourceRequest.current?.abort() }
  }, [refs, accountScope])
  useEffect(() => {
    for (const row of rows) if (row.readAt && !row.loading && !row.error) peopleViewCache.write(accountScope, `records:${row.facet.key}`, row, row.cacheAt)
  }, [rows, accountScope])
  useEffect(() => {
    if (!moreSentinel.current || rows.some(x => x.loading)) return
    const next = rows.find(x => x.nextCursor && !x.error)
    if (!next) return
    const observer = new IntersectionObserver(entries => { if (entries.some(x => x.isIntersecting)) void read(next.facet, controller.current!.signal, next.nextCursor) }, { root: moreSentinel.current.closest('.explore-detail'), rootMargin: '120px' })
    observer.observe(moreSentinel.current); return () => observer.disconnect()
  }, [rows])
  const evidence = mergeExploreEvidence(...rows.map(row => row.items)).sort((a, b) => b.date - a.date || a.key.localeCompare(b.key))
  const open = async (ref: string) => {
    const c = new AbortController(); sourceRequest.current?.abort(); sourceRequest.current = c; setOpening(ref); setError('')
    try { const result = await callArkme<ExploreSource>('explore.source', { ref }, c.signal); if (c.signal.aborted) return
      if (result.kind === 'conversation') arkmeUi.showConversationTarget(result.source, result.itemUid, result.sendAtMillis, undefined, undefined, true)
      else setSource(result)
    } catch (e) { if (!c.signal.aborted) setError(errorText(e)) } finally { if (!c.signal.aborted) setOpening('') }
  }
  return <section className="explore-sources">
    <p className="explore-muted">{tr('这里是提及或关联此人的原文，不代表都是本人说的话。')}</p>
    {evidence.map(row => <article className="explore-evidence" key={row.key}><div className="explore-muted">{row.label} · {date(row.date)}</div><p>{row.text}</p>{row.mentions && row.mentions.length > 1 && <div className="explore-muted">{tr('此原文提及')} {row.mentions.length} {tr('处')}</div>}{row.ref ? <button className="explore-source-link" disabled={!!opening} onClick={() => void open(row.ref!)}>{tr(opening === row.ref ? '正在打开…' : '定位原文')} ↗</button> : <span className="explore-muted">{tr(row.unavailableReason ?? '来源暂不可定位')}</span>}</article>)}
    {(loading || rows.some(x => x.loading)) && <div className="explore-loading" role="status"><div className="explore-more"><span className="explore-loading-dot"/>{tr('正在读取相关记录…')}</div><div className="explore-skeleton"><i/><i/></div></div>}
    {rows.map(row => row.error ? <p className="explore-error" role="alert" key={row.facet.key}>{row.error} <button className="explore-source-link" onClick={() => void read(row.facet, controller.current!.signal, row.retryCursor)}>{tr('重试')}</button></p>
      : null)}
    <div ref={moreSentinel} className="explore-more">{evidence.length > 0 ? `${tr('已显示')} ${evidence.length} ${tr('条原始记录')}` : ''}</div>
    {!loading && !rows.some(x => x.loading) && !evidence.length && <p className="explore-muted">{tr(unavailable || rows.some(x => x.error) ? '相关记录暂不可用' : '暂无已明确关联的关系记录。独立人物的历史关联需要后端补齐。')}</p>}
    {error && <p role="alert" className="explore-error">{error}</p>}
    {source?.kind === 'record' && <ArkmeTimelineDetailDrawer item={source.item} canExtend={false} showOriginal={original} onToggleOriginal={() => setOriginal(x => !x)} onClose={() => setSource(undefined)}/>}
    {source?.kind === 'recording' && <ExploreRecordingSource source={source} onClose={() => setSource(undefined)}/>}
  </section>
}
