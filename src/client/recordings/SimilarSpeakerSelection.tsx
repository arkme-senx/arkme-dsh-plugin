import type { SpeakerGroupMembers, SpeakerGroupPreview } from '../../speaker-group-contract.js'
import { useRecordingPlayback } from './useRecordingPlayback.js'
import { ArkmeRecordingSpeakerReview } from './ArkmeRecordingSpeakerReview.js'
import { SpeakerGroupTask } from './SpeakerGroupTask.js'
import { useEffect, useRef, useState, type CSSProperties } from 'react'
import type { ArkmeRecordingSpeakerCorrectionInput, ArkmeRecordingWorkbenchItem } from '../../types.js'
import type { SpeakerDirectoryDetail, SpeakerDirectoryPerson } from '../../speaker-directory-contract.js'
import { callArkme } from '../api.js'
import { arkmeTheme as color } from '../arkme-theme.js'
import { tr } from '../locale.js'
import { ArkmeRecordingSpeakerCorrection } from './ArkmeRecordingSpeakerCorrection.js'

const button: CSSProperties = { padding: '6px 9px', border: `1px solid ${color.border}`, borderRadius: 7, background: color.base, color: color.text, cursor: 'pointer', font: 'inherit', fontSize: 12 }

/** Individual selection is default; whole-group commands require explicit scope and preview. */
export function SimilarSpeakerSelection({ people, assignment, rejectedPerson, onBack }: {
  people: SpeakerDirectoryPerson[]
  assignment?: ArkmeRecordingSpeakerCorrectionInput['target'] | { kind: 'directory'; person: SpeakerDirectoryPerson }
  rejectedPerson?: SpeakerDirectoryPerson
  onBack(): void
}) {
  const playback = useRecordingPlayback('/arkme-self/api/media')
  const action = useRef<AbortController>()
  useEffect(() => () => action.current?.abort(), [])
  const [groups,setGroups]=useState<Record<string,SpeakerGroupMembers>>({})
  const [sort,setSort]=useState<'review'|'time'>('review')
  const [compare,setCompare]=useState(false)
  const [scope,setScope]=useState<'selected'|'whole'>('selected')
  const [groupPreview,setGroupPreview]=useState<SpeakerGroupPreview>()
  const [readRevision,setReadRevision]=useState(0)
  const [items, setItems] = useState<ArkmeRecordingWorkbenchItem[]>([])
  const [selected, setSelected] = useState(new Set<string>())
  const [error, setError] = useState(''), [loading, setLoading] = useState(true)
  const [command, setCommand] = useState<{ range?: boolean; assignment?: ArkmeRecordingSpeakerCorrectionInput['target']; rejectedCandidateItemRef?: string; rejected?: { label: string; optionKey: string; speakerRef: string } }>()
  useEffect(() => {
    const controller = new AbortController(); setLoading(true); setError(''); setGroups({}); setItems([]); setSelected(new Set())
    void Promise.all(people.map(person => callArkme<SpeakerGroupMembers>('speaker-directory.group-members', { detailRef: person.detailRef, sort }, controller.signal)))
      .then(pages => {
        if (controller.signal.aborted) return
        const rows = [...new Map(pages.flatMap(page => page.items).map(row => [row.itemId, row])).values()]
        setGroups(Object.fromEntries(pages.map((p,i)=>[people[i]!.personKey,p])))
        setItems(rows.sort((a, b) => a.startAtMillis - b.startAtMillis)); setLoading(false)
      }).catch(reason => { if (!controller.signal.aborted) { setError(reason instanceof Error ? reason.message : tr('片段读取失败')); setLoading(false) } })
    return () => controller.abort()
  }, [people.map(p=>p.detailRef).join('|'),readRevision,sort])
  const loadMore=async(person:SpeakerDirectoryPerson)=>{
    const previous=groups[person.personKey];if(!previous?.nextCursor||loading)return
    setLoading(true);setError('');const c=new AbortController();action.current=c
    try{const page=await callArkme<SpeakerGroupMembers>('speaker-directory.group-members',{detailRef:person.detailRef,sort,cursor:previous.nextCursor},c.signal);if(c.signal.aborted)return
      if(page.totalCount!==previous.totalCount)throw new Error(tr('分组已变化，请重新读取'))
      setGroups(old=>({...old,[person.personKey]:{...page,items:[...previous.items,...page.items],evidence:[...previous.evidence??[],...page.evidence??[]]}}));setItems(old=>[...new Map([...old,...page.items].map(x=>[x.itemId,x])).values()].sort((a,b)=>a.startAtMillis-b.startAtMillis))
    }catch(e){if(!c.signal.aborted)setError(e instanceof Error?e.message:tr('成员读取失败'))}finally{if(!c.signal.aborted)setLoading(false)}
  }
  const wholePreview=async()=>{
    if(loading||people.some(p=>!groups[p.personKey]||groups[p.personKey]!.requiresReview))return
    setLoading(true);setError('');const c=new AbortController();action.current=c
    try{const value=await callArkme<SpeakerGroupPreview>('speaker-directory.group-action',{action:'preview',snapshots:people.map(p=>groups[p.personKey]!.snapshotRef),idempotencyKey:crypto.randomUUID(),
      ...(rejectedPerson?{excludedDetailRef:rejectedPerson.detailRef}:{target:assignment?.kind==='directory'?{kind:'directory',detailRef:assignment.person.detailRef}:assignment})},c.signal);if(!c.signal.aborted)setGroupPreview(value)
    }catch(e){if(!c.signal.aborted)setError(e instanceof Error?e.message:tr('整组预览失败'))}finally{if(!c.signal.aborted)setLoading(false)}
  }
  const evidence = new Map(Object.values(groups).flatMap(g=>g.evidence??[]).map(e=>[e.itemRef,e]))
  const visible = [...items].sort((a,b)=>{
    if(sort==='time')return a.startAtMillis-b.startAtMillis
    const x=evidence.get(a.itemRef)?.deviation,y=evidence.get(b.itemRef)?.deviation
    if(x==null||y==null)return x==null&&y!=null?-1:x!=null&&y==null?1:a.startAtMillis-b.startAtMillis
    return y-x||a.startAtMillis-b.startAtMillis
  })
  const chosen = items.filter(item => selected.has(item.itemId))
  const next = async (rows = chosen, range = false) => {
    if (!rows.length || loading) return
    setLoading(true); setError('')
    const controller = new AbortController(); action.current = controller
    try {
      let resolved = assignment?.kind === 'directory' ? undefined : assignment
      let rejectedCandidateItemRef: string | undefined
      let rejected: { label: string; optionKey: string; speakerRef: string } | undefined
      const person = assignment?.kind === 'directory' ? assignment.person : rejectedPerson
      if (person) {
        const detail = await callArkme<SpeakerDirectoryDetail>('speaker-directory.open', { detailRef: person.detailRef }, controller.signal)
        if (detail.type !== 'speaker') {
          if (!rejectedPerson) throw new Error(tr('请选择已标记人物作为目标'))
          const anchor = await callArkme<{ items: ArkmeRecordingWorkbenchItem[] }>('speaker-directory.correction-items', { detailRef: person.detailRef }, controller.signal)
          if (!anchor.items[0]) throw new Error(tr('基准声音没有可核实片段'))
          rejectedCandidateItemRef = anchor.items[0].itemRef
        } else if (rejectedPerson) rejected = { speakerRef: detail.speakerRef, optionKey: person.personKey, label: person.displayName }
        else resolved = { kind: 'existing', speakerRef: detail.speakerRef }
      }
      controller.signal.throwIfAborted()
      setSelected(new Set(rows.map(row=>row.itemId)))
      setCommand({ range, ...(rejectedCandidateItemRef ? { rejectedCandidateItemRef } : {}), ...(resolved ? { assignment: resolved } : {}), ...(rejected ? { rejected } : {}) })
    } catch (reason) { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : tr('目标读取失败')) }
    finally { if (!controller.signal.aborted) setLoading(false) }
  }
  const targetLabel = rejectedPerson ? `${tr('排除同人关联')}：${rejectedPerson.displayName}` : assignment?.kind==='directory' ? assignment.person.displayName : assignment?.kind==='new' ? assignment.name : tr(assignment?.kind==='unknown'?'未知说话人':'新的未命名说话人')
  if(compare&&items[0])return <ArkmeRecordingSpeakerReview item={items[0]} items={items} explicitScope options={[]} onPlay={(item,range)=>{void playback.playItem(item,item.startAtMillis+(range?.startOffsetMillis??0),range?item.startAtMillis+range.endOffsetMillis:undefined)}} onUpdated={()=>setReadRevision(v=>v+1)} onClose={()=>setCompare(false)}/>
  if(groupPreview)return <SpeakerGroupTask initialPreview={groupPreview} targetLabel={targetLabel} onBack={()=>setGroupPreview(undefined)}/>
  if (command && chosen[0]) return <ArkmeRecordingSpeakerCorrection item={chosen[0]} items={chosen} initialRange={command.range === true} initialSelectedIds={chosen.map(item => item.itemId)}
    {...(command.assignment ? { assignment: command.assignment, ...(assignment?.kind === 'directory' ? { assignmentLabel: assignment.person.displayName } : {}) } : {})} {...(command.rejected ? { target: command.rejected } : {})}
    {...(command.rejectedCandidateItemRef ? { rejectedCandidateItemRef: command.rejectedCandidateItemRef } : {})} {...(rejectedPerson ? { exclusionLabel: rejectedPerson.displayName } : {})} crossDateSelection preserveAssignment={!!rejectedPerson} intent={rejectedPerson ? 'reject' : 'review'} rejectCurrent={false} onPlay={(item, range) => { void playback.playItem(item, item.startAtMillis + (range?.startOffsetMillis ?? 0), range ? item.startAtMillis + range.endOffsetMillis : undefined) }} onUpdated={() => {}} onBack={() => setCommand(undefined)} onClose={onBack} />
  return <section style={{ marginTop: 12, fontSize: 12 }} aria-label={tr('选择纠错片段')}>
    <p>{tr('试听片段与完整成员分开。默认逐项选择，最多 100 段；仅明确选择整组后才包含未加载的历史成员。')}</p><div>{(['selected','whole'] as const).map(mode=><label key={mode} style={{marginRight:12}}><input type="radio" name="group-scope" checked={scope===mode} disabled={loading} onChange={()=>setScope(mode)}/>{tr(mode==='selected'?'逐片段选择':'所选分组的全部片段')}</label>)}</div>
    {scope==='whole'&&<p style={{color:color.secondary}}>{tr('整组一次最多原子保存 2000 段，以后台去重后的预览范围为准；超限不会保存，请减少分组或改为逐片段选择。')}</p>}
    {people.map(person=><div key={person.personKey} style={{marginTop:8}}>{person.displayName} · {groups[person.personKey]?.totalCount ?? '…'} {tr('段')}{groups[person.personKey]?.requiresReview&&<span style={{color:color.danger}}> · {tr('混合或待确认，请选择子集')}</span>}{groups[person.personKey]?.nextCursor&&<button style={button} disabled={loading} onClick={()=>void loadMore(person)}>{tr('加载更多成员')}</button>}</div>)}
    <div style={{ marginTop: 10 }}><label>{tr('成员排序')} <select value={sort} disabled={loading} onChange={e=>setSort(e.target.value as 'review'|'time')} style={button}><option value="review">{tr('最需核对优先')}</option><option value="time">{tr('时间顺序')}</option></select></label> <button style={button} disabled={loading||!items.length} onClick={()=>setCompare(true)}>{tr('甲乙参照对比')}</button></div>
    {people.map(person=>{const group=groups[person.personKey];return group&&<p key={`coverage-${person.personKey}`} style={{color:color.secondary}}>{person.displayName} · {group.consistency?tr('已分析 {v0} / {v1} 段',{v0:group.consistency.analyzedCount,v1:group.consistency.totalCount}):tr('证据覆盖尚未返回')}{group.consistency?.reviewCount!=null?` · ${tr('待核对 {v0} 段',{v0:group.consistency.reviewCount})}`:''} · {tr('一致性仅供复核，不是身份准确率')}</p>})}
    {playback.error&&<p role="alert" style={{color:color.danger}}>{playback.error}</p>}
    {loading && <p role="status">{tr('读取片段中…')}</p>}
    {error && <p role="alert" style={{ color: color.danger }}>{error} <button style={button} disabled={loading} onClick={()=>setReadRevision(v=>v+1)}>{tr('重新读取成员')}</button></p>}
    {visible.map(item => <div key={item.itemId} style={{ display: 'flex', gap: 8, padding: '9px 0', borderBottom: `1px solid ${color.border}` }}>
      <input type="checkbox" aria-label={tr('选择片段 {v0}', { v0: item.itemId })} checked={selected.has(item.itemId)} disabled={scope==='whole' || loading || !selected.has(item.itemId) && selected.size >= 100}
        onChange={event => { const checked = event.target.checked; setSelected(old => { const next = new Set(old); if (checked) next.add(item.itemId); else next.delete(item.itemId); return next }) }} />
      <span><span style={{ color: color.secondary }}>{new Date(item.startAtMillis).toLocaleString()} · {item.speakerLabel}</span><br />{item.text}<br/><small style={{color:color.secondary}}>{evidence.get(item.itemRef)?.deviation!=null?tr('偏离距离：{v0}',{v0:evidence.get(item.itemRef)!.deviation!.toFixed(3)}):tr('证据不足，需试听核对')}</small><br/><button type="button" style={button} disabled={playback.isLoading} onClick={()=>void playback.playItem(item)}>{tr('试听')}</button> <button type="button" style={button} disabled={loading} onClick={()=>void next([item],true)}>{tr('句内拆分')}</button></span>
    </div>)}
    {!loading && !items.length && !error && <p>{tr('没有可修改的片段，请重新读取目录。')}</p>}
    <div style={{ display: 'flex', gap: 8, marginTop: 10 }}><button style={button} disabled={loading} onClick={onBack}>{tr('返回核对')}</button><span style={{ flex: 1 }}>{tr('已选 {v0} 段', { v0: selected.size })}</span><button style={button} disabled={loading || (scope==='selected' ? !selected.size || selected.size > 100 : people.some(p=>!groups[p.personKey]||groups[p.personKey]!.requiresReview))} onClick={() => { if(scope==='whole')void wholePreview();else void next() }}>{tr(scope==='whole'?'预览完整分组范围':'核实所选范围')}</button></div>
  </section>
}
