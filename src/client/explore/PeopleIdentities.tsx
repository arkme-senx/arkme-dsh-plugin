import { useEffect, useRef, useState } from 'react'
import type { PeopleIdentityCapabilities, PeopleIdentityLink, PeopleIdentityPreview, PeopleIdentityReceipt, UnifiedPerson } from '../../people-contract.js'
import { PEOPLE_SOURCE_LABELS } from '../../people-contract.js'
import { callArkme } from '../api.js'
import { ArkmeConfirmDialog } from '../ArkmeConfirmDialog.js'
import { ArkmeDetailShell } from '../ArkmeDetailShell.js'
import { tr } from '../locale.js'
import { usePeopleDirectory } from './usePeopleDirectory.js'
import { PeopleIdentityImpactPanel } from './PeopleIdentityImpact.js'
import { PeopleLoading } from './PeopleSurface.js'
import { peopleViewCache } from './people-view-cache.js'

const message = (e: unknown) => e instanceof Error ? e.message : tr('操作失败，请重试')
export function PeopleIdentities({ person, people, accountScope, onChanged, onClose }: {
  person: UnifiedPerson; people: UnifiedPerson[]; accountScope: string; onChanged(): void; onClose(): void
}) {
  const [capabilities,setCapabilities]=useState<PeopleIdentityCapabilities>()
  const [capabilityError,setCapabilityError]=useState(''),[capabilityRevision,setCapabilityRevision]=useState(0)
  useEffect(()=>{const c=new AbortController();setCapabilities(undefined);setCapabilityError('')
    void callArkme<PeopleIdentityCapabilities>('people.identities',{action:'capabilities'},c.signal).then(value=>{if(!c.signal.aborted)setCapabilities(value)}).catch(e=>{if(!c.signal.aborted)setCapabilityError(message(e))})
    return()=>c.abort()
  },[accountScope,capabilityRevision])
  const can=(kind:string)=>capabilities?.supported===true && capabilities[kind as Exclude<keyof Extract<PeopleIdentityCapabilities,{supported:true}>,'supported'>]===true
  const [impactReady, setImpactReady] = useState(false)
  const [query, setQuery] = useState('')
  const directory = usePeopleDirectory(accountScope, query)
  const candidatePeople = query.trim() ? directory.people : [...new Map([...people, ...directory.people].map(p => [p.key, p])).values()]
  const personRef = person.facets.find(f => f.personRef)?.personRef
  const anchorIdentityRef = person.facets.find(f => f.identityRef && f.source !== 'relations')?.identityRef
  const cacheKey = `identity-operation:${person.facets.find(f => f.personIdentityKey)?.personIdentityKey ?? person.key}`
  const [links, setLinks] = useState<PeopleIdentityLink[]>([]), [busy, setBusy] = useState(false), [error, setError] = useState('')
  const [choice, setChoice] = useState(''), [mode, setMode] = useState<'link' | 'merge'>('link')
  type Pending = PeopleIdentityPreview & { label: string }
  const [restored] = useState(() => peopleViewCache.read(accountScope, `${cacheKey}:pending`, (v): v is Pending => !!v && typeof (v as Pending).commandRef === 'string' && typeof (v as Pending).label === 'string')?.value)
  const [preview, setPreview] = useState<Pending | undefined>(restored), [unknown, setUnknown] = useState(!!restored)
  const [operationRef, setOperationRef] = useState(() => peopleViewCache.read(accountScope, cacheKey, (v): v is string => typeof v === 'string')?.value)
  const controller = useRef(new AbortController())
  const [revision, setRevision] = useState(0)
  useEffect(() => { const c = new AbortController(); controller.current = c
    if (personRef) { setBusy(true); void callArkme<{ links: PeopleIdentityLink[]; operationRef?: string }>('people.identities', { action: 'list', personRef }, c.signal)
      .then(value => { if (!c.signal.aborted) { setLinks(value.links); setOperationRef(value.operationRef) } }).catch(e => { if (!c.signal.aborted) setError(message(e)) }).finally(() => { if (!c.signal.aborted) setBusy(false) }) }
    return () => c.abort()
  }, [personRef, revision])
  const candidates = mode === 'merge'
    ? candidatePeople.filter(p => p.key !== person.key && p.facets.some(f => f.personRef)).map(p => ({ key: p.key, label: p.name, params: { otherPersonRef: p.facets.find(f => f.personRef)!.personRef } }))
    : candidatePeople.flatMap(p => p.facets).filter(f => f.identityRef && f.source !== 'relations' && !person.facets.some(own => own.key === f.key) && !links.some(l => l.identityKey === f.identityKey))
      .map(f => ({ key: f.key, label: `${f.name} · ${tr(PEOPLE_SOURCE_LABELS[f.source])}`, params: { identityRef: f.identityRef, ...(!personRef && f.personRef ? { otherPersonRef: f.personRef } : {}) } }))
  const prepare = async (kind: string, label: string, params: Record<string, unknown>) => {
    if (!can(kind) || busy || (!personRef && !anchorIdentityRef)) return
    setBusy(true); setError(''); setPreview(undefined); setImpactReady(false)
    const signal = controller.current.signal
    try {
      const value = await callArkme<PeopleIdentityPreview>('people.identities', { action: 'preview', kind, ...(personRef ? { personRef } : { anchorIdentityRef }), ...params, idempotencyKey: crypto.randomUUID() }, signal)
      if (!signal.aborted) { setPreview({ ...value, label }); setUnknown(false) }
    } catch (e) { if (!signal.aborted) setError(message(e)) }
    finally { if (!signal.aborted) setBusy(false) }
  }
  const save = async (recover = false) => {
    if (!preview || busy || !recover && !unknown && !impactReady) return
    setBusy(true); setError(''); const signal = controller.current.signal
    peopleViewCache.write(accountScope, `${cacheKey}:pending`, preview, Date.now())
    try {
      const receipt = await callArkme<PeopleIdentityReceipt>('people.identities', { action: recover ? 'result' : 'apply', commandRef: preview.commandRef }, signal)
      if (signal.aborted) return
      setOperationRef(receipt.operationRef); peopleViewCache.write(accountScope, cacheKey, receipt.operationRef, Date.now())
      peopleViewCache.remove(accountScope, `${cacheKey}:pending`)
      setPreview(undefined); setUnknown(false); setRevision(v => v + 1); onChanged()
    } catch (e) {
      if (!signal.aborted) {
        if (!recover && (e as { body?: { code?: string } })?.body?.code === 'people-identity-rejected') {
          peopleViewCache.remove(accountScope, `${cacheKey}:pending`)
          setPreview(undefined); setUnknown(false); setRevision(v => v + 1); onChanged()
          setError(`${message(e)}。${tr('本次未保存，请重新读取并预览。')}`)
        } else {
          setUnknown(true); setError(`${message(e)}。${tr('保存结果待确认，请查询结果或使用同一预览重试。')}`)
        }
      }
    }
    finally { if (!signal.aborted) setBusy(false) }
  }
  return <ArkmeDetailShell title={tr('关联身份')} label={tr('关联身份')} onClose={onClose}><div className="arkme-explore-dialog">
    {capabilityError&&<p role="alert" className="explore-error">{capabilityError} <button className="explore-source-link" onClick={()=>setCapabilityRevision(v=>v+1)}>{tr('重新读取能力')}</button></p>}
    {capabilities?.supported===false&&<p className="explore-muted">{tr('人物关联写入暂未开放，已有资料仍可查看。')}</p>}
    {!capabilities&&!capabilityError&&<p role="status" className="explore-muted">{tr('正在读取人物关联能力…')}</p>}
    {person.facets.map(facet => <div className="people-identity" key={facet.key}><strong>{facet.name}</strong><span className="explore-muted">{tr(PEOPLE_SOURCE_LABELS[facet.source])}</span></div>)}
    {!personRef && <p className="explore-muted">{tr(anchorIdentityRef ? '确认关联后建立人物档案；同名身份不会自动合并。' : '此来源暂不能用于人物关联，请刷新后重试。')}</p>}
    {links.map(link => { const facet = people.flatMap(p => p.facets).find(f => f.identityKey === link.identityKey)
      return <div className="people-identity" key={link.identityKey}><div><strong>{facet?.name ?? tr(link.namespace === 'relation_entity' ? '已合并人物' : link.namespace === 'audio_speaker' ? '录音身份' : '联系人身份')}</strong><details className="explore-muted"><summary>{tr('查看关联依据')}</summary>{link.provenance?.kind === 'user_decision' ? <p>{tr('你已手动确认')} · {new Date(link.provenance.confirmedAt).toLocaleString()}<br/>{tr('操作')}：{tr(({link:'关联',unlink:'解除关联',merge:'合并人物',split:'拆出人物',undo:'撤销操作',materialize:'建立人物档案'} as Record<string,string>)[link.provenance.action] ?? '人工确认')}<br/>{tr('依据与当前关联版本一致')}</p> : <p>{tr('来源依据未记录')}</p>}</details></div>
        {link.namespace === 'relation_entity' && link.splitRef && <button className="explore-button" disabled={!can('split') || busy || !!preview} onClick={() => void prepare('split', tr('拆出为独立人物'), { otherPersonRef: link.splitRef })}>{tr('拆出人物')}</button>}{link.namespace !== 'relation_entity' && <button className="explore-button" disabled={!can('unlink') || busy || !!preview} onClick={() => void prepare('unlink', `${tr('解除关联')}：${facet?.name ?? tr('此身份')}`, { identityRef: link.identityRef })}>{tr('解除关联')}</button>}</div>
    })}
    {(personRef || anchorIdentityRef) && <><div className="explore-filters">{(['link', 'merge'] as const).map(kind => <button key={kind} className="explore-filter" aria-pressed={mode === kind} disabled={busy || !can(kind)} onClick={() => { setMode(kind); setChoice('') }}>{tr(kind === 'link' ? '关联已有身份' : '合并人物')}</button>)}</div>
      <input className="explore-search" aria-label={tr('搜索关联候选')} placeholder={tr('搜索全账号人物或身份')} value={query} onChange={e => { setQuery(e.target.value); setChoice('') }}/><PeopleLoading reads={directory.reads} onRetry={directory.refresh}/><div role="radiogroup" aria-label={tr('选择身份或人物')} style={{ maxHeight: 320, overflowY: 'auto', border: '1px solid var(--dsw-alias-border-1, #e5e5e5)', borderRadius: 8 }} onScroll={event => { const el = event.currentTarget; if (el.scrollHeight - el.scrollTop - el.clientHeight < 60 && directory.hasMore && !Object.values(directory.reads).some(r => r.loading || r.error)) directory.loadMore() }}>{candidates.map(c => <label key={c.key} className="explore-row" style={{ display: 'flex', alignItems: 'center', gap: 12, padding: 12, cursor: busy ? 'default' : 'pointer' }}><input type="radio" name="identity-candidate" value={c.key} checked={choice === c.key} disabled={busy} onChange={() => setChoice(c.key)} style={{ width: 16, height: 16, flexShrink: 0, margin: 0 }}/><span>{c.label}</span></label>)}{!candidates.length && <p className="explore-muted" style={{ padding: 12 }}>{tr('暂无匹配的人物或身份')}</p>}{directory.hasMore && <button className="explore-source-link" disabled={Object.values(directory.reads).some(r => r.loading)} onClick={directory.loadMore}>{tr('加载更多候选')}</button>}</div>
      {choice && <p className="explore-muted" role="note">{tr(query.trim() ? '候选来自人物目录搜索，名称命中不代表已经确认是同一人。' : '候选来自现有人物与身份目录，尚未确认是同一人。')}<br/>{tr('已有绑定和排除关系将在预览时核验，不会自动关联。')}</p>}
      <div className="explore-detail-actions"><button className="explore-button" disabled={busy || !choice || !can(mode)} onClick={() => { const c = candidates.find(c => c.key === choice); if (c) void prepare(mode, `${tr(mode === 'merge' ? '合并人物' : '关联身份')}：${!personRef && 'otherPersonRef' in c.params ? `${person.name} → ${c.label}` : `${c.label} → ${person.name}`}`, c.params) }}>{tr('预览影响')}</button>
      {operationRef && <button className="explore-button" disabled={busy || !can('undo')} onClick={() => void prepare('undo', tr('撤销最近操作'), { operationRef })}>{tr('撤销最近操作')}</button>}</div></>}
    {preview && <ArkmeConfirmDialog titleId="people-identity-impact" title={preview.label} description={tr('核对影响范围后再确认，来源内容保留不变。')} busy={busy} error={error} confirmDisabled={!unknown && !impactReady} confirmLabel={tr(unknown ? '重试同一操作' : '确认保存')} busyLabel={tr('正在处理…')} cancelLabel={tr(unknown ? '关闭，稍后核验' : '取消')} onConfirm={() => void save()} onClose={() => { if (unknown) onClose(); else setPreview(undefined) }}>{preview.changes?.map((change, index) => <p key={`${change.identityKey}:${index}`}>{people.flatMap(p => p.facets).find(f => f.identityKey === change.identityKey)?.name ?? tr(change.namespace === 'relation_entity' ? '关系人物' : change.namespace === 'audio_speaker' ? '录音身份' : '联系人身份')} · {tr(change.beforeState === 'active' ? '已关联' : '未关联')} → {tr(change.afterState === 'active' ? '关联到目标人物' : '解除关联')}</p>)}<p>{tr('影响身份')}：{preview.changeCount} · {tr('来源内容保留不变')}</p>{!unknown && <PeopleIdentityImpactPanel commandRef={preview.commandRef} onReady={setImpactReady}/>}{unknown && <button className="explore-button" disabled={busy} onClick={() => void save(true)}>{tr('查询保存结果')}</button>}</ArkmeConfirmDialog>}

    {busy && <p role="status" className="explore-muted">{tr('正在读取…')}</p>}{error && <p role="alert" className="explore-error">{error} {!unknown && <button className="explore-source-link" disabled={busy} onClick={()=>{setError('');setPreview(undefined);setChoice('');setRevision(v=>v+1);directory.refresh();onChanged()}}>{tr('重新读取')}</button>}</p>}
  </div></ArkmeDetailShell>
}
