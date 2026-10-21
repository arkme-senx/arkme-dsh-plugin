import { useEffect, useRef, useState, type CSSProperties } from 'react'
import type { SpeakerDirectoryPerson } from '../../speaker-directory-contract.js'
import { speakerGroupConsistencyLabel, type SimilarSpeaker, type SpeakerSimilarityResult, type SpeakerVoiceSamples } from '../../speaker-similarity-contract.js'
import { callArkme } from '../api.js'
import { arkmeTheme as color } from '../arkme-theme.js'
import { tr } from '../locale.js'
import { recognizedSpeakerDirectory, type RecognizedSpeakerDirectory } from '../recognized-speaker-directory.js'
import { useSingleAudioPlayback } from '../redesign/contacts/useSingleAudioPlayback.js'

const button: CSSProperties = { padding: '6px 9px', border: `1px solid ${color.border}`, borderRadius: 7, background: color.base, color: color.text, cursor: 'pointer', font: 'inherit', fontSize: 12 }
const box: CSSProperties = { padding: 12, border: `1px solid ${color.border}`, borderRadius: 9, background: color.base }
const message = (error: unknown) => error instanceof Error ? error.message : '声音暂时无法读取'

function VoiceComparison({ accountKey, anchor, other }: { accountKey: string; anchor: SpeakerDirectoryPerson; other: SpeakerDirectoryPerson }) {
  const [samples, setSamples] = useState<Record<string, SpeakerVoiceSamples>>({}), [errors, setErrors] = useState<Record<string, string>>({})
  const [revision, setRevision] = useState(0), [next, setNext] = useState<'anchor' | 'other'>('anchor')
  const playback = useSingleAudioPlayback(`${accountKey}:${anchor.personKey}:${other.personKey}:${revision}`)
  const people = other.personKey === anchor.personKey ? [anchor] : [anchor, other]
  useEffect(() => {
    const controller = new AbortController(); setSamples({}); setErrors({}); setNext('anchor')
    people.forEach(person => {
      void callArkme<SpeakerVoiceSamples>('speaker-directory.voice-samples', { detailRef: person.detailRef }, controller.signal)
        .then(value => { if (!controller.signal.aborted) setSamples(old => ({ ...old, [person.personKey]: value })) })
        .catch(error => { if (!controller.signal.aborted) setErrors(old => ({ ...old, [person.personKey]: message(error) })) })
    })
    return () => controller.abort()
  }, [accountKey, anchor.detailRef, other.detailRef, revision])
  const first = (person: SpeakerDirectoryPerson) => { const result = samples[person.personKey]; return result?.supported ? result.items.find(item => item.mediaRef) : undefined }
  const alternate = () => {
    const person = next === 'anchor' ? anchor : other, sample = first(person)
    if (sample?.mediaRef) { void playback.toggle(sample.sampleKey, sample.mediaRef); setNext(next === 'anchor' ? 'other' : 'anchor') }
  }
  return <section aria-label={tr('声音片段比较')} style={{ ...box, marginTop: 10 }}>
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
      <strong style={{ flex: 1 }}>{tr(people.length === 1 ? '试听声音片段' : '比较两组声音')}</strong>
      {people.length > 1 && <button type="button" style={button} disabled={!first(anchor) || !first(other)} onClick={alternate}>{tr('交替试听 · 下一段{v0}', { v0: next === 'anchor' ? '基准' : '候选' })}</button>}
      <button type="button" style={button} onClick={() => { playback.stop(); setRevision(value => value + 1) }}>{tr('重新读取片段')}</button>
    </div>
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>{people.map(person => {
      const result = samples[person.personKey], error = errors[person.personKey]
      return <div key={person.personKey} style={{ flex: '1 1 220px', minWidth: 0 }}>
        <strong>{person.displayName}</strong>
        {error ? <p role="alert" style={{ color: color.danger }}>{error}</p> : !result ? <p role="status">{tr('读取片段中…')}</p>
          : !result.supported ? <p>{tr('该人物的声音片段暂不可用。')}</p> : result.items.length === 0 ? <p>{tr('暂无可试听片段。')}</p>
            : result.items.map(sample => <div key={sample.sampleKey} style={{ padding: '9px 0', borderBottom: `1px solid ${color.borderSoft}` }}>
              <div style={{ display: 'flex', gap: 5, alignItems: 'center', flexWrap: 'wrap' }}><span style={{ color: color.secondary, flex: 1 }}>{sample.timeLabel} · {(sample.durationMillis / 1000).toFixed(0)} {tr('秒')}</span>
                <button type="button" style={button} disabled={!sample.mediaRef} onClick={() => { if (sample.mediaRef) void playback.toggle(sample.sampleKey, sample.mediaRef) }}>{tr(playback.loadingSegmentRef === sample.sampleKey ? '加载中…' : playback.activeSegmentRef === sample.sampleKey ? '停止' : '试听')}</button></div>
              <p style={{ margin: '6px 0 0', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', maxHeight: 100, overflow: 'auto' }}>{sample.transcript}</p>
              {playback.errors[sample.sampleKey] && <div role="alert" style={{ color: color.danger }}>{playback.errors[sample.sampleKey]}</div>}
            </div>)}
      </div>
    })}</div>
    <p style={{ color: color.secondary, marginBottom: 0 }}>{tr('试听仅供核对。几个片段不能代表整组已经确认是同一个人。')}</p>
  </section>
}

function ExistingPersonPicker({ accountKey, directory, selected, onSelect }: { accountKey: string; directory: RecognizedSpeakerDirectory; selected?: SpeakerDirectoryPerson; onSelect(person: SpeakerDirectoryPerson): void }) {
  const [query, setQuery] = useState(''), [rows, setRows] = useState<SpeakerDirectoryPerson[]>([]), [error, setError] = useState(''), [loading, setLoading] = useState(false)
  useEffect(() => {
    const controller = new AbortController(); setRows([]); setError(''); setLoading(true)
    const timer = setTimeout(() => {
      void directory.first(accountKey, { filter: 'marked', sort: 'frequent', query }, controller.signal)
        .then(result => { if (!controller.signal.aborted) { setRows(result.items); setLoading(false) } })
        .catch(error => { if (!controller.signal.aborted) { setError(message(error)); setLoading(false) } })
    }, 250)
    return () => { clearTimeout(timer); controller.abort() }
  }, [accountKey, directory, query])
  return <div style={{ marginTop: 8 }}>
    <input aria-label={tr('搜索目标人物')} placeholder={tr('搜索已有的人物')} value={query} onChange={event => setQuery(event.target.value)} style={{ ...button, boxSizing: 'border-box', width: '100%' }} />
    {selected && <p>{tr('已选目标：')}{selected.displayName}</p>}
    {error && <p role="alert" style={{ color: color.danger }}>{error}</p>}
    {loading ? <p role="status">{tr('读取人物中…')}</p> : <div style={{ maxHeight: 180, overflow: 'auto' }}>{rows.map(person => <button key={person.personKey} type="button" style={{ ...button, margin: '6px 6px 0 0' }} aria-pressed={selected?.personKey === person.personKey} onClick={() => onSelect(person)}>{person.displayName}</button>)}{rows.length === 0 && !error && <p>{tr('没有匹配的人物。')}</p>}</div>}
    <small style={{ color: color.secondary }}>{tr('先显示前 50 位，可搜索具体人物。')}</small>
  </div>
}

export function SimilarSpeakersPanel({ accountKey, row, onBack, directory = recognizedSpeakerDirectory }: {
  accountKey: string; row: SpeakerDirectoryPerson; onBack(): void; directory?: RecognizedSpeakerDirectory
}) {
  // A new identity remounts all selections, previews and playback leases.
  return <SimilarityView key={`${accountKey}:${row.detailRef}`} accountKey={accountKey} row={row} onBack={onBack} directory={directory} />
}
function SimilarityView({ accountKey, row, onBack, directory }: { accountKey: string; row: SpeakerDirectoryPerson; onBack(): void; directory: RecognizedSpeakerDirectory }) {
  const [result, setResult] = useState<SpeakerSimilarityResult>(), [error, setError] = useState(''), [loading, setLoading] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(() => new Set()), [comparison, setComparison] = useState<SpeakerDirectoryPerson>()
  const [preview, setPreview] = useState<'same' | 'different'>(), [targetMode, setTargetMode] = useState<'existing' | 'new' | 'anonymous'>('existing')
  const [target, setTarget] = useState<SpeakerDirectoryPerson | undefined>(row.type === 'marked' ? row : undefined), [name, setName] = useState('')
  const request = useRef<AbortController>(), requestId = useRef(0), cursors = useRef(new Set<string>())
  const load = async (more = false) => {
    request.current?.abort(); const controller = new AbortController(); request.current = controller
    const generation = ++requestId.current, previous = more && result?.supported ? result : undefined
    setLoading(true); setError('')
    if (!more) { setResult(undefined); setSelected(new Set()); setPreview(undefined); setComparison(undefined); cursors.current.clear() }
    try {
      const next = await callArkme<SpeakerSimilarityResult>('speaker-directory.similar', { detailRef: row.detailRef, ...(previous ? { cursor: previous.nextCursor, version: previous.version } : {}) }, controller.signal)
      if (controller.signal.aborted || generation !== requestId.current) return
      if (previous) {
        if (!next.supported || next.state !== 'ready' || next.version !== previous.version || next.anchor.personKey !== previous.anchor.personKey || next.modelVersion !== previous.modelVersion || next.aggregation !== previous.aggregation || next.scoreDefinition !== previous.scoreDefinition
          || next.hasMore && (next.nextCursor === previous.nextCursor || cursors.current.has(next.nextCursor))) throw new Error(tr('相似声音证据已变化，请重新查找。'))
        const seen = new Set(previous.items.map(item => item.person.personKey))
        if (next.items.some(item => seen.has(item.person.personKey))) throw new Error(tr('相似声音分页重复，请重新查找。'))
        cursors.current.add(previous.nextCursor)
        setResult({ ...next, items: [...previous.items, ...next.items] })
      } else setResult(next)
    } catch (error) { if (!controller.signal.aborted) { setError(message(error)); setSelected(new Set()); setPreview(undefined) } }
    finally { if (!controller.signal.aborted) setLoading(false) }
  }
  useEffect(() => { void load(); return () => { requestId.current++; request.current?.abort() } }, [])
  const data = result?.supported ? result : undefined
  const chosen = data?.items.filter(item => selected.has(item.person.personKey)) ?? []
  const consistency = data?.anchorConsistency
  const check = (candidate: SimilarSpeaker, checked: boolean) => setSelected(old => { const next = new Set(old); if (checked) next.add(candidate.person.personKey); else next.delete(candidate.person.personKey); return next })
  return <section aria-label={tr('找相似声音')} style={{ fontSize: 12, lineHeight: 1.6 }}>
    <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}><button type="button" style={button} onClick={onBack}>{tr('‹ 返回人物详情')}</button><strong style={{ flex: 1, fontSize: 17 }}>{tr('找相似声音')}</strong><button type="button" style={button} disabled={loading} onClick={() => { void load() }}>{tr('重新查找')}</button></div>
    <div style={{ ...box, marginTop: 12 }}><strong>{row.displayName}</strong><span style={{ marginLeft: 10, color: color.secondary }}>{tr('组内一致性')} {tr(speakerGroupConsistencyLabel(consistency))}</span>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginTop: 6 }}><span style={{ flex: 1, color: color.secondary }}>{consistency ? tr('已分析 {v0} / {v1} 段', { v0: consistency.analyzedCount, v1: consistency.totalCount }) : tr('以这个声音为基准，查找其他可能属于同一人的分组。')}</span><button type="button" style={button} onClick={() => setComparison(row)}>{tr('试听 / 查看片段')}</button></div>
    </div>
    {comparison && !preview && <><VoiceComparison key={`${accountKey}:${comparison.detailRef}`} accountKey={accountKey} anchor={row} other={comparison} /><button type="button" style={{ ...button, marginTop: 7 }} onClick={() => setComparison(undefined)}>{tr('收起片段')}</button></>}
    {error && <p role="alert" style={{ color: color.danger }}>{error}</p>}
    {loading && <p role="status">{tr('正在查找相似声音…')}</p>}
    {result?.supported === false && <p role="status" style={{ ...box, color: color.secondary }}>{tr('相似声音检索暂未开放。你可以先试听当前声音；候选距离、一致性和批量归并需后端提供支持。')}</p>}
    {data && !preview && <>
      <p style={{ color: color.secondary }}>{tr('已检索 {v0} / {v1} 个分组', { v0: data.searchedCount, v1: data.totalCount })} · {tr('距离越小越接近，不代表是同一个人的概率。')}</p>
      <details style={{ color: color.secondary }}><summary style={{ cursor: 'pointer' }}>{tr('查看证据口径')}</summary><div>{tr('模型：')}{data.modelVersion} · {tr('版本：')}{data.version}</div><div>{tr('距离计算：')}{data.aggregation}</div><div>{tr('一致性定义：')}{data.scoreDefinition}</div></details>
      {data.state !== 'ready' ? <p role="status">{tr(data.state === 'building' ? '相似声音索引正在准备，稍后可重新查找。' : '可比较的声纹证据不足，暂不能给出相似候选。')}</p>
        : data.items.length === 0 ? <p>{tr('当前已检索范围内没有相似候选。')}</p> : <ul style={{ listStyle: 'none', margin: '12px 0', padding: 0 }}>{data.items.map(candidate => <li key={candidate.person.personKey} style={{ ...box, marginBottom: 8 }}>
          <div style={{ display: 'flex', alignItems: 'start', gap: 9 }}><input type="checkbox" aria-label={tr('选择 {v0}', { v0: candidate.person.displayName })} checked={selected.has(candidate.person.personKey)} disabled={loading || !!error || !selected.has(candidate.person.personKey) && selected.size >= 100} onChange={event => check(candidate, event.target.checked)} />
            <div style={{ flex: 1, minWidth: 0 }}><strong>{candidate.person.displayName}</strong><span style={{ marginLeft: 8, color: color.secondary }}>{tr('出现 {v0} 天', { v0: candidate.person.dayCount })}</span>
              <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', fontVariantNumeric: 'tabular-nums' }}><span>{tr('距离')} {candidate.distance === null ? '—' : candidate.distance.toFixed(3)}</span><span>{tr('组内一致性')} {tr(speakerGroupConsistencyLabel(candidate.consistency))}</span></div>
              <div style={{ color: color.secondary }}>{tr('已分析 {v0} / {v1} 段', { v0: candidate.consistency.analyzedCount, v1: candidate.consistency.totalCount })}{candidate.consistency.reviewCount ? ` · ${tr('{v0} 段待复核，建议先核对组内声音', { v0: candidate.consistency.reviewCount })}` : ''}</div>
              {candidate.reason && <div style={{ color: color.secondary }}>{candidate.reason}</div>}
            </div><button type="button" style={button} onClick={() => setComparison(candidate.person)}>{tr('比较片段')}</button></div>
        </li>)}</ul>}
      {data.hasMore && <button type="button" style={button} disabled={loading || !!error} onClick={() => { void load(true) }}>{tr('查看更多相似声音')}</button>}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', position: 'sticky', bottom: 0, background: color.layer1, padding: '12px 0', borderTop: `1px solid ${color.border}` }}><span style={{ flex: 1 }}>{tr('已选 {v0} 个候选组', { v0: chosen.length })}</span><button type="button" style={button} disabled={!chosen.length || loading || !!error} onClick={() => setPreview('different')}>{tr('不是同一个人')}</button><button type="button" style={button} disabled={!chosen.length || loading || !!error} onClick={() => setPreview('same')}>{tr('预览统一标记')}</button></div>
    </>}
    {preview && <div style={{ ...box, marginTop: 12 }}>
      <strong>{tr(preview === 'same' ? '统一标记预览' : '排除关系预览')}</strong>
      <p>{preview === 'same' ? tr('本次包含基准声音及所选 {v0} 个候选组。', { v0: chosen.length }) : tr('仅排除基准声音与所选 {v0} 个候选组之间的同人关系。', { v0: chosen.length })}</p>
      <ul><li>{row.displayName} · {tr('基准声音')}</li>{chosen.map(candidate => <li key={candidate.person.personKey}>{candidate.person.displayName} · {tr('{v0} 段', { v0: candidate.consistency.totalCount })}</li>)}</ul>
      {preview === 'same' ? <><p style={{ color: color.secondary }}>{tr('最终涉及的日期、去重片段数与混合声音冲突，需要后台预览核实。此处不会把分组数量当成人数。')}</p>
        <fieldset style={{ border: 0, padding: 0 }}><legend>{tr('统一到')}</legend>{([['existing', '已有的人物'], ['new', '新人物'], ['anonymous', '暂不知道姓名']] as const).map(([mode, label]) => <label key={mode} style={{ marginRight: 10, display: 'inline-block' }}><input type="radio" name="similar-speaker-target" checked={targetMode === mode} onChange={() => setTargetMode(mode)} /> {tr(label)}</label>)}</fieldset>
        {targetMode === 'existing' && <ExistingPersonPicker accountKey={accountKey} directory={directory} {...(target ? { selected: target } : {})} onSelect={setTarget} />}
        {targetMode === 'new' && <input aria-label={tr('新人物名称')} placeholder={tr('输入姓名或备注')} value={name} maxLength={40} onChange={event => setName(event.target.value)} style={{ ...button, marginTop: 8 }} />}
        {targetMode === 'anonymous' && <p>{tr('保留一个匿名身份，之后可以再补姓名；原始录音和分组来源仍保留。')}</p>}
      </> : <p style={{ color: color.secondary }}>{tr('候选之间的关系保持不变，不代表它们彼此不同。后续检索应遵守已确认的排除关系。')}</p>}
      <p role="status" style={{ color: color.secondary }}>{tr('这只是预览，尚未保存。需要后端提供范围核对、版本校验、持久化及撤销支持。')}</p>
      <div style={{ display: 'flex', gap: 8, justifyContent: 'space-between' }}><button type="button" style={button} onClick={() => setPreview(undefined)}>{tr('返回核对')}</button><button type="button" style={button} disabled>{tr('等待后端支持保存')}</button></div>
    </div>}
  </section>
}
