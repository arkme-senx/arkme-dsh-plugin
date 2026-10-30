import { useCallback, useEffect, useRef, useState } from 'react'
import { Check } from '@phosphor-icons/react/dist/icons/Check'
import { CaretRight } from '@phosphor-icons/react/dist/icons/CaretRight'
import type { TeamMemberCandidate, TeamMemberCandidatePage, TeamMemberCandidateSource, TeamMemberAddResult, TeamMemberAdditionRecovery } from '../team-member-add-contract.js'
import { callArkme } from './api.js'
import { ArkmeUserAvatar } from './ArkmeAvatar.js'
import { tr, useArkmeLocale } from './locale.js'
import { TeamFeatureDialog } from './redesign/contacts/TeamFeatureDialog.js'

type Props = { accountKey: string; teamRef: string; teamName: string; onClose(): void; onChanged?(): void }
type PageState = { data?: TeamMemberCandidatePage; loading?: boolean; error?: string }
const errorText = (error: unknown) => error instanceof Error ? error.message : tr('加载失败，请重试')

export function TeamAddMembersDialog(props: Props) {
  return <ScopedDialog key={`${props.accountKey}:${props.teamRef}`} {...props} />
}

function ScopedDialog({ accountKey, teamRef, teamName, onClose, onChanged }: Props) {
  useArkmeLocale()
  const [source, setSource] = useState<'contacts' | 'conversations'>('contacts')
  const [query, setQuery] = useState(''), [pages, setPages] = useState<Record<string, PageState>>({})
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [selected, setSelected] = useState<Map<string, TeamMemberCandidate>>(new Map())
  const [busy, setBusy] = useState(true), [pending, setPending] = useState(false), [error, setError] = useState('')
  const [result, setResult] = useState<TeamMemberAddResult>()
  const refreshCandidates = useRef<() => void>()
  const changed = useRef(onChanged); changed.current = onChanged
  const cache = useRef(pages), requests = useRef(new Map<string, AbortController>())
  const submission = useRef<AbortController>(), requestUid = useRef(''), body = useRef<HTMLDivElement>(null)
  const publish = useCallback((key: string, value: PageState) => {
    cache.current = { ...cache.current, [key]: value }; setPages(cache.current)
  }, [])
  useEffect(() => () => { for (const controller of requests.current.values()) controller.abort(); submission.current?.abort() }, [])
  useEffect(() => { if (busy || pending) body.current?.focus({ preventScroll: true }) }, [busy, pending])

  const applyResult = useCallback(async (value: TeamMemberAddResult, signal: AbortSignal) => {
    if (value.state !== 'completed' || !Array.isArray(value.items)) throw new Error(tr('添加结果返回异常，请核对原批次'))
    setResult(value)
    const joined = new Set(value.items.filter(item => item.status !== 'rejected').map(item => item.key))
    setSelected(current => new Map([...current].filter(([key]) => !joined.has(key))))
    changed.current?.()
    await callArkme('team.app.members.add-ack', {expectedAccountKey: accountKey, teamRef, requestUid: value.requestUid}, signal)
    requestUid.current = ''; setPending(false)
    refreshCandidates.current?.()
  }, [accountKey, teamRef, publish])
  useEffect(() => {
    const controller = new AbortController()
    void (async () => {
      try {
        const value = await callArkme<TeamMemberAdditionRecovery>('team.app.members.add-recover', {expectedAccountKey: accountKey, teamRef}, controller.signal)
        if (controller.signal.aborted) return
        if (value.state === 'completed') await applyResult(value, controller.signal)
        else if (value.state === 'unresolved') { requestUid.current = value.requestUid; setPending(true) }
        else if (value.state !== 'none') throw new Error(tr('原批次状态异常，请重试核对'))
      } catch (caught) { if (!controller.signal.aborted) { setPending(true); setError(errorText(caught)) } }
      finally { if (!controller.signal.aborted) setBusy(false) }
    })()
    return () => controller.abort()
  }, [accountKey, teamRef, applyResult])

  const load = useCallback(async (key: string, kind: TeamMemberCandidateSource, sourceRef?: string, restart = false) => {
    if (requests.current.has(key)) return
    const previous = cache.current[key], cursor = restart ? undefined : previous?.data?.nextCursor
    const controller = new AbortController(); requests.current.set(key, controller)
    publish(key, { ...previous, loading: true })
    try {
      const result = await callArkme<TeamMemberCandidatePage>('team.app.member-candidates', {
        expectedAccountKey: accountKey, teamRef, source: kind,
        ...(sourceRef ? { sourceRef } : {}), ...(cursor ? { cursor } : {}), ...(restart ? { refresh: true } : {}),
      }, controller.signal)
      if (controller.signal.aborted) return
      if (!Array.isArray(result.items) || !Array.isArray(result.groups) || typeof result.hasMore !== 'boolean'
        || (result.hasMore && (!result.nextCursor || result.nextCursor === cursor))) throw new Error(tr('候选列表返回异常，请重试'))
      const items = new Map((cursor ? previous?.data?.items ?? [] : []).map(item => [item.key, item]))
      const groups = new Map((cursor ? previous?.data?.groups ?? [] : []).map(item => [item.sourceKey, item]))
      for (const item of result.items) items.set(item.key, item)
      for (const item of result.groups) groups.set(item.sourceKey, item)
      publish(key, { data: { ...result, items: [...items.values()], groups: [...groups.values()] } })
      // Refresh sealed refs and drop newly joined members without losing unrelated selections.
      setSelected(current => {
        const next = new Map(current)
        for (const item of result.items) if (next.has(item.key)) {
          if (item.alreadyMember || item.isSelf) next.delete(item.key); else next.set(item.key, item)
        }
        return next
      })
    } catch (caught) { if (!controller.signal.aborted) publish(key, { ...previous, loading: false, error: errorText(caught) }) }
    finally { if (requests.current.get(key) === controller) requests.current.delete(key) }
  }, [accountKey, teamRef, publish])
  refreshCandidates.current = () => {
    for (const request of requests.current.values()) request.abort()
    requests.current.clear(); cache.current = {}; setPages({})
    void load(source, source, undefined, true)
    if (source === 'conversations') for (const ref of expanded) void load(ref, 'group', ref, true)
  }
  useEffect(() => {
    if (!cache.current[source]) void load(source, source)
    if (source === 'conversations') for (const ref of expanded) if (!cache.current[ref]) void load(ref, 'group', ref)
  }, [source, expanded, load])

  // Search advances the active source, preserving rendered rows and selection.
  // Group member reads remain explicit: only expanded groups are searched.
  useEffect(() => {
    if (!query.trim()) return
    const timer = setTimeout(() => {
      const current = cache.current[source]
      if (current?.data?.hasMore && !current.loading && !current.error) void load(source, source)
      if (source === 'conversations') for (const ref of expanded) {
        const state = cache.current[ref]
        if (state?.data?.hasMore && !state.loading && !state.error) void load(ref, 'group', ref)
      }
    }, 250)
    return () => clearTimeout(timer)
  }, [query, source, expanded, pages, load])

  const reset = () => { setPending(false); setError(''); requestUid.current = '' }
  const toggle = (item: TeamMemberCandidate) => {
    if (busy || pending || item.alreadyMember || item.isSelf) return
    if (!selected.has(item.key) && selected.size >= 50) { setError(tr('每次最多选择 50 人')); return }
    reset(); setSelected(current => { const next = new Map(current); if (next.has(item.key)) next.delete(item.key); else next.set(item.key, item); return next })
  }
  const submit = async () => {
    if ((!selected.size && !pending) || submission.current) return
    const controller = new AbortController(); submission.current = controller
    requestUid.current ||= crypto.randomUUID(); setBusy(true); setError('')
    try {
      if (pending) {
        const recovered = await callArkme<TeamMemberAdditionRecovery>('team.app.members.add-recover', {expectedAccountKey: accountKey, teamRef}, controller.signal)
        if (controller.signal.aborted) return
        if (recovered.state === 'completed') { await applyResult(recovered, controller.signal); return }
        if (recovered.state === 'none') { setPending(false); requestUid.current = ''; return }
      }
      const value = await callArkme<TeamMemberAddResult>(pending ? 'team.app.members.add-retry' : 'team.app.members.add', {
        expectedAccountKey: accountKey, teamRef, ...(pending ? {} : {candidateRefs: [...selected.values()].map(item => item.candidateRef), requestUid: requestUid.current}),
      }, controller.signal)
      if (controller.signal.aborted) return
      await applyResult(value, controller.signal)
    } catch (caught) { if (!controller.signal.aborted) setPending(true); setError(errorText(caught)) }
    finally { if (submission.current === controller) submission.current = undefined; if (!controller.signal.aborted) setBusy(false) }
  }
  const needle = query.trim().toLocaleLowerCase()
  const matches = (item: TeamMemberCandidate) => [item.displayName, item.nickname, item.accountName].some(value => value?.toLocaleLowerCase().includes(needle))
  const row = (item: TeamMemberCandidate) => <button type="button" className="arkme-team-add-person" key={item.key}
    role="checkbox" aria-checked={selected.has(item.key)} aria-label={item.displayName} disabled={busy || pending || item.alreadyMember || item.isSelf}
    onClick={() => toggle(item)}>
    <ArkmeUserAvatar {...(item.avatarRef ? { avatarRef: item.avatarRef } : {})} {...(item.avatarFallback ? { fallback: item.avatarFallback } : {})} size={36} label={item.displayName} />
    <span className="arkme-team-add-person-copy"><strong>{item.displayName}</strong>{item.accountName && <small>@{item.accountName}</small>}</span>
    {item.alreadyMember || item.isSelf ? <small>{tr('已加入')}</small> : <span className="arkme-team-add-check" data-checked={selected.has(item.key)}>{selected.has(item.key) && <Check size={14} weight="bold" />}</span>}
  </button>
  const pageFeedback = (key: string, kind: TeamMemberCandidateSource, sourceRef?: string) => {
    const state = pages[key]
    return <>
      {state?.loading && <p className="arkme-team-add-hint" role="status">{tr('加载中…')}</p>}
      {state?.error && <div className="arkme-team-add-error" role="alert">{state.error}<button type="button" onClick={() => { void load(key, kind, sourceRef, true) }}>{tr('重新加载')}</button></div>}
      {state?.data?.coverage === 'partial' && <p className="arkme-team-add-hint">{tr('联系人尚未加载完整，可重新加载或从最近对话选人。')}<button onClick={() => { void load(key, kind, sourceRef, true) }}>{tr('重新加载')}</button></p>}
      {state?.data?.hasMore && !state.loading && !state.error && <button type="button" className="arkme-team-add-more" onClick={() => { void load(key, kind, sourceRef) }}>{tr('加载更多')}</button>}
    </>
  }
  const page = pages[source], visiblePeople = page?.data?.items.filter(matches) ?? []
  return <TeamFeatureDialog title={tr('添加成员')} teamName={teamName} className="arkme-team-add-dialog" onClose={onClose}
    footer={<div className="arkme-team-add-footer">
      {selected.size > 0 && <div className="arkme-team-add-selected" aria-label={tr('已选成员')}>{[...selected.values()].map(item => <button type="button" key={item.key} title={tr('取消选择 {v0}', { v0: item.displayName })} aria-label={tr('取消选择 {v0}', { v0: item.displayName })} disabled={busy || pending} onClick={() => toggle(item)}>
        <ArkmeUserAvatar {...(item.avatarRef ? { avatarRef: item.avatarRef } : {})} {...(item.avatarFallback ? { fallback: item.avatarFallback } : {})} size={30} label={item.displayName} /><span aria-hidden="true">×</span>
      </button>)}</div>}
      <div className="arkme-team-add-submit"><span>{tr('已选 {v0} 人', { v0: selected.size })}</span><button type="button" disabled={(!selected.size && !pending) || busy} onClick={() => { void submit() }}>{busy ? tr('正在处理…') : pending ? tr('核对并重试原批次') : tr('确认添加（{v0}）', { v0: selected.size })}</button></div>
    </div>}>
    <div ref={body} tabIndex={-1} className="arkme-team-add-body">
      <div className="arkme-team-add-controls"><input type="search" aria-label={tr('搜索成员')} placeholder={tr('搜索姓名、备注或即我号')} value={query} onChange={event => setQuery(event.target.value)} />
        <div className="arkme-team-add-sources" role="group" aria-label={tr('选人来源')}>{(['contacts', 'conversations'] as const).map(kind => <button type="button" key={kind} aria-pressed={source === kind} onClick={() => setSource(kind)}>{tr(kind === 'contacts' ? '联系人' : '最近对话与群聊')}</button>)}</div>
      </div>
      {(pending || error) && <div className="arkme-team-add-feedback">
        {pending && <p role="status">{tr('原批次结果待核对，已保留请求。请核对后再选择下一批。')}</p>}
        {error && <div role="alert" className="arkme-team-add-error">{error}<button onClick={() => { void load(source, source, undefined, true) }}>{tr('刷新候选列表')}</button></div>}
      </div>}
      <div className="arkme-team-add-feedback"><p className="arkme-team-add-hint">{tr('同事将直接加入团队，并可访问团队已有的共享内容。')}</p></div>
      {result && <div className="arkme-team-add-feedback" role="status"><p>{tr('批次完成时团队共 {v0} 人', {v0: result.memberCount})}</p><ul>{result.items.map((item, index) => <li key={item.key}>{item.displayName ?? tr('同事 {v0}', {v0: index + 1})}：{tr(item.status === 'added' ? '已添加' : item.status === 'already_member' ? '已在团队' : '账号不可用，未添加')}</li>)}</ul></div>}
      <div className="arkme-team-add-list">
        {visiblePeople.map(row)}
        {source === 'conversations' && page?.data?.groups.map(group => {
          const open = expanded.has(group.sourceRef), groupPage = pages[group.sourceRef]
          return <div key={group.sourceKey} className="arkme-team-add-group"><button type="button" className="arkme-team-add-group-title" aria-expanded={open} onClick={() => {
            setExpanded(current => { const next = new Set(current); if (next.has(group.sourceRef)) next.delete(group.sourceRef); else next.add(group.sourceRef); return next })
            if (!open && !groupPage) void load(group.sourceRef, 'group', group.sourceRef)
          }}><CaretRight size={14} style={{ transform: open ? 'rotate(90deg)' : undefined }} /><span>{group.displayName}</span></button>
            {open && <div className="arkme-team-add-group-people">{groupPage?.data?.items.filter(matches).map(row)}{pageFeedback(group.sourceRef, 'group', group.sourceRef)}</div>}
          </div>
        })}
        {pageFeedback(source, source)}
        {page?.data && !page.loading && !page.error && !page.data.hasMore && visiblePeople.length === 0 && page.data.groups.length === 0 && <p className="arkme-team-add-hint">{tr(needle ? '当前来源未找到匹配的人' : '暂无可选成员')}</p>}
        {source === 'conversations' && !!page?.data?.groups.length && <p className="arkme-team-add-hint">{tr('展开群聊后，可搜索和选择其中的成员。')}</p>}
      </div>
    </div>
  </TeamFeatureDialog>
}
