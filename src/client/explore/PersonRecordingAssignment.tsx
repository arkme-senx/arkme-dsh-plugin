import { useEffect, useRef, useState } from 'react'
import type { UnifiedPerson } from '../../people-contract.js'
import type { ArkmeRecordingWorkbenchItem } from '../../types.js'
import { callArkme } from '../api.js'
import { ArkmeDetailShell } from '../ArkmeDetailShell.js'
import { ArkmeRecordingSpeakerCorrection } from '../recordings/ArkmeRecordingSpeakerCorrection.js'
import { useRecordingPlayback } from '../recordings/useRecordingPlayback.js'
import { tr } from '../locale.js'

/** Explore has no implicit current recording; require an explicit date/time and row. */
export function PersonRecordingAssignment({ person, onClose, onChanged }: { person: UnifiedPerson; onClose(): void; onChanged(): void }) {
  const playback = useRecordingPlayback('/arkme-self/api/media')
  const [at, setAt] = useState(''), [source, setSource] = useState<'system' | 'doubao'>('system')
  const [items, setItems] = useState<ArkmeRecordingWorkbenchItem[]>([]), [item, setItem] = useState<ArkmeRecordingWorkbenchItem>()
  const [target, setTarget] = useState(''), [binding, setBinding] = useState<{ state: string; commandRef: string }>()
  const [busy, setBusy] = useState(false), [error, setError] = useState('')
  const controller = useRef(new AbortController())
  useEffect(() => { const c=new AbortController();controller.current=c;return()=>c.abort() }, [person.key])
  const candidates = [...new Map(person.facets.filter(f=>f.assignmentRef).map(f=>[f.assignmentRef!,f])).values()]
  const personRef=person.facets.find(f=>f.personRef && !f.accountLinked)?.personRef
  const run = async (work: (signal: AbortSignal) => Promise<void>) => { setBusy(true);setError('');const signal=controller.current.signal
    try {await work(signal)}catch(e){if(!signal.aborted)setError(e instanceof Error?e.message:tr('操作失败，请重试'))}finally{if(!signal.aborted)setBusy(false)} }
  const load = () => run(async signal => {
    const stamp=new Date(at).getTime(),day=new Date(stamp);day.setHours(0,0,0,0)
    if(!Number.isFinite(stamp))throw new Error(tr('请选择明确的录音日期与时间'))
    const page=await callArkme<{items:ArkmeRecordingWorkbenchItem[]}>('recordings.speaker.correction.items',{dateStamp:day.getTime(),atMillis:stamp,transcriptSource:source},signal)
    if(!signal.aborted){setItems(page.items);setItem(undefined);setTarget('');setBinding(undefined)}
  })
  const choose = (row: ArkmeRecordingWorkbenchItem) => run(async signal => {
    setItem(row)
    if(candidates.length===1){setTarget(candidates[0]!.assignmentRef!);return}
    if(candidates.length>1)return
    if(!personRef)throw new Error(tr('此人物尚无可用录音身份，请先建立人物档案'))
    const preview=await callArkme<{state:string;commandRef:string}>('people.identities',{action:'binding-preview',personRef},signal)
    if(!signal.aborted)setBinding(preview)
  })
  const bind = () => run(async signal => {if(!binding)return
    const value=await callArkme<{speakerRef:string}>('people.identities',{action:'binding-apply',commandRef:binding.commandRef},signal)
    if(!signal.aborted)setTarget(value.speakerRef)
  })
  return <ArkmeDetailShell title={`${tr('用于录音标记')} · ${person.name}`} label={tr('用于录音标记')} onClose={onClose}><div className="arkme-explore-dialog">
    {item && target ? <ArkmeRecordingSpeakerCorrection key={`${item.itemId}:${target}`} item={item} items={items} assignment={{kind:'existing',speakerRef:target}} assignmentLabel={person.name} initialSelectedIds={[item.itemId]} rejectCurrent={false} intent="review" onPlay={(row,range)=>{void playback.playItem(row,row.startAtMillis+(range?.startOffsetMillis??0),range?row.startAtMillis+range.endOffsetMillis:undefined)}} onUpdated={onChanged} onClose={onClose} onBack={()=>{setItem(undefined);setTarget('');setBinding(undefined)}}/>
      : <><p className="explore-muted">{tr('先选择录音日期和时间，再选择需要标记的原文片段。不会默认修改最近一句。')}</p>
        <label>{tr('录音日期和时间')} <input className="explore-search" type="datetime-local" value={at} onChange={e=>setAt(e.target.value)}/></label>
        <select className="explore-search" aria-label={tr('转写来源')} value={source} onChange={e=>setSource(e.target.value as 'system'|'doubao')}><option value="system">{tr('原始转写')}</option><option value="doubao">{tr('增强转写')}</option></select>
        <button className="explore-button" disabled={!at||busy} onClick={()=>void load()}>{tr('读取附近片段')}</button>
        {items.map(row=><button key={row.itemId} className="explore-row" disabled={busy} aria-pressed={row.itemId===item?.itemId} onClick={()=>void choose(row)}><span className="explore-row-meta">{new Date(row.startAtMillis).toLocaleString()} · {row.speakerLabel}</span><p>{row.text}</p></button>)}
        {item && candidates.length>1 && <section className="explore-evidence"><p>{tr('此人物有多个录音身份，请明确选择本次目标')}</p>{candidates.map(f=><button className="explore-button" key={f.key} onClick={()=>setTarget(f.assignmentRef!)}>{f.name}</button>)}</section>}
        {binding && <section className="explore-evidence"><p>{tr(binding.state==='reuse'?'将复用此人物已有的录音身份。':'将为此人物建立并关联一个录音身份，无需对方注册账号。')}</p><p className="explore-muted">{tr('随后仍需确认片段范围。撤销片段纠错会保留可复用的人物身份。')}</p><button className="explore-button" disabled={busy} onClick={()=>void bind()}>{tr('确认并继续标记')}</button></section>}
      </>}
    {playback.error&&<p role="alert" className="explore-error">{playback.error}</p>}
    {busy&&<p role="status">{tr('正在读取…')}</p>}{error&&<p role="alert" className="explore-error">{error}</p>}
  </div></ArkmeDetailShell>
}
