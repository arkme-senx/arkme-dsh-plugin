import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import type { ArkmeRecordingDay, ArkmeRecordingSpeakerEvidence, ArkmeRecordingSpeakerOption, ArkmeRecordingWorkbenchItem } from '../../types.js'
import { callArkme } from '../api.js'
import { arkmeAuthStore } from '../auth-store.js'
import { arkmeTheme as color } from '../arkme-theme.js'
import { tr } from '../locale.js'
import { ArkmeRecordingSpeakerCorrection } from './ArkmeRecordingSpeakerCorrection.js'
import { recordingConsistencyLabel, useRecordingConsistency } from './use-recording-consistency.js'

const button: CSSProperties = { border: `1px solid ${color.border}`, borderRadius: 6, padding: '6px 9px', background: color.base, color: color.text, font: 'inherit', fontSize: 12, cursor: 'pointer' }
const time = (stamp: number) => new Date(stamp).toLocaleTimeString('zh-CN', { hour12: false })
type EvidenceRow = Extract<ArkmeRecordingSpeakerEvidence, { supported: true }>['items'][number]
type Filter = 'all' | 'a' | 'b' | 'ambiguous' | 'insufficient'

export function speakerReviewItems(items: readonly ArkmeRecordingWorkbenchItem[], anchor: ArkmeRecordingWorkbenchItem, nearby = false) {
  const rows = new Map([anchor, ...items].map(row => [row.itemId, row]))
  return [...rows.values()].filter(row => row.transcriptSource === anchor.transcriptSource
    && new Date(row.startAtMillis).toDateString() === new Date(anchor.startAtMillis).toDateString()
    && (nearby ? Math.abs(row.startAtMillis - anchor.startAtMillis) <= 10 * 60_000 : row.speakerKey === anchor.speakerKey))
    .sort((a, b) => a.startAtMillis - b.startAtMillis || a.itemId.localeCompare(b.itemId))
}

export function speakerEvidenceBucket(row?: EvidenceRow, margin = 0): Exclude<Filter, 'all'> {
  if (!row || row.status !== 'ready' || row.distanceA === null || row.distanceB === null) return 'insufficient'
  if (Math.abs(row.distanceA - row.distanceB) <= margin) return 'ambiguous'
  return row.distanceA < row.distanceB ? 'a' : 'b'
}

export function ArkmeRecordingSpeakerReview({ item, items, options, onPlay, onUpdated, onClose }: {
  item: ArkmeRecordingWorkbenchItem
  items: readonly ArkmeRecordingWorkbenchItem[]
  options: readonly ArkmeRecordingSpeakerOption[]
  onPlay?(item: ArkmeRecordingWorkbenchItem): void
  onUpdated(day: ArkmeRecordingDay): void
  onClose(): void
}) {
  const [nearby, setNearby] = useState(false)
  const [advanced, setAdvanced] = useState(false)
  const [deviationFirst, setDeviationFirst] = useState(true)
  const [page, setPage] = useState(0)
  const [a, setA] = useState<string[]>([])
  const [b, setB] = useState<string[]>([])
  const [selected, setSelected] = useState<Set<string>>(() => new Set())
  const [filter, setFilter] = useState<Filter>('all')
  const [suspiciousFirst, setSuspiciousFirst] = useState(false)
  const [preview, setPreview] = useState(false)
  const [saving, setSaving] = useState(false)
  const [targetMode, setTargetMode] = useState<'unknown' | 'existing' | 'new'>('unknown')
  const [targetKey, setTargetKey] = useState('')
  const [newName, setNewName] = useState('')
  const [nextReference, setNextReference] = useState<'a' | 'b'>('a')
  const [reviewLine, setReviewLine] = useState<number>()
  const [evidence, setEvidence] = useState<{ key: string; value?: ArkmeRecordingSpeakerEvidence; error?: string; loading: boolean }>({ key: '', loading: false })
  const request = useRef<AbortController>()
  const listRef = useRef<HTMLDivElement>(null)
  const initialAccount = useRef(arkmeAuthStore.getSnapshot().auth)
  const mounted = useRef(true)
  const all = useMemo(() => [...new Map([item, ...items].map(row => [row.itemId, row])).values()], [items, item])
  const candidates = useMemo(() => speakerReviewItems(all, item, nearby), [all, item, nearby])
  const pages = Math.max(1, Math.ceil(candidates.length / 50))
  const pageIndex = Math.min(page, pages - 1)
  const pageItems = candidates.slice(pageIndex * 50, pageIndex * 50 + 50)
  const consistency = useRecordingConsistency([item.itemRef], pageItems.map(row => row.itemRef))
  const group = consistency.groups[0]
  const deviations = new Map(group?.items.map(row => [row.itemRef, row]) ?? [])
  const referenceA = all.filter(row => a.includes(row.itemId))
  const referenceB = all.filter(row => b.includes(row.itemId))
  const chosen = all.filter(row => selected.has(row.itemId)).sort((left, right) => left.startAtMillis - right.startAtMillis)
  const input = { itemRefs: pageItems.map(row => row.itemRef), referenceA: referenceA.map(row => row.itemRef), referenceB: referenceB.map(row => row.itemRef) }
  const signature = JSON.stringify(input)
  const current = evidence.key === signature ? evidence : undefined
  const value = current?.value?.supported ? current.value : undefined
  const scores = new Map(value?.state === 'ready' ? value.items.map(row => [row.itemRef, row]) : [])
  const references = new Set([...a, ...b])
  const visible = pageItems.filter(row => !advanced || filter === 'all' || (!references.has(row.itemId) && speakerEvidenceBucket(scores.get(row.itemRef), value?.ambiguityMargin) === filter))
  if (!advanced && deviationFirst) visible.sort((left, right) => (deviations.get(right.itemRef)?.deviation ?? -1) - (deviations.get(left.itemRef)?.deviation ?? -1) || left.startAtMillis - right.startAtMillis)
  if (advanced && suspiciousFirst) visible.sort((left, right) => {
    const rank = (row: ArkmeRecordingWorkbenchItem) => references.has(row.itemId) ? 4 : ({ b: 0, ambiguous: 1, insufficient: 2, a: 3 }[speakerEvidenceBucket(scores.get(row.itemRef), value?.ambiguityMargin)])
    return rank(left) - rank(right) || left.startAtMillis - right.startAtMillis
  })
  useEffect(() => {
    mounted.current = true
    const unsubscribe = arkmeAuthStore.subscribe(() => {
      const auth = arkmeAuthStore.getSnapshot().auth, original = initialAccount.current
      if (auth?.userId !== original?.userId || auth?.environment !== original?.environment || auth?.status !== original?.status) {
        mounted.current = false; request.current?.abort(); onClose()
      }
    })
    return () => { mounted.current = false; request.current?.abort(); unsubscribe() }
  }, [])
  useEffect(() => { request.current?.abort(); setFilter('all'); setReviewLine(undefined) }, [signature])
  useEffect(() => { if (listRef.current) listRef.current.scrollTop = 0 }, [pageIndex, filter, nearby])

  const compare = async () => {
    if (!input.referenceA.length || !input.itemRefs.length || current?.loading) return
    request.current?.abort()
    const controller = new AbortController(); request.current = controller
    setEvidence({ key: signature, loading: true })
    try {
      const result = await callArkme<ArkmeRecordingSpeakerEvidence>('recordings.speaker.evidence', input, controller.signal)
      if (!controller.signal.aborted && mounted.current) {
        setEvidence({ key: signature, value: result, loading: false })
        setReviewLine(result.supported ? result.reviewThreshold : undefined)
      }
    } catch (error) {
      if (!controller.signal.aborted && mounted.current) setEvidence({ key: signature, error: error instanceof Error ? error.message : tr('声纹证据读取失败'), loading: false })
    }
  }
  const setReference = (side: 'a' | 'b', id: string) => {
    const list = side === 'a' ? a : b
    if (!list.includes(id) && list.length >= 3) return
    const update = side === 'a' ? setA : setB, other = side === 'a' ? setB : setA
    update(list.includes(id) ? list.filter(value => value !== id) : [...list, id]); other(values => values.filter(value => value !== id))
    // Trusted A references are not included in the proposed rejection of A.
    if (side === 'a') setSelected(values => new Set([...values].filter(value => value !== id)))
    setPreview(false)
  }
  const alternate = () => {
    const rows = nextReference === 'a' ? referenceA : referenceB
    if (rows[0]) { onPlay?.(rows[0]); setNextReference(nextReference === 'a' ? 'b' : 'a') }
  }
  const renderReference = (side: 'a' | 'b', rows: ArkmeRecordingWorkbenchItem[]) => <div style={{ flex: '1 1 240px', minWidth: 0, padding: 10, borderRadius: 8, background: color.layer2 }}>
    <strong style={{ fontSize: 12 }}>{side === 'a' ? tr('参照甲 · 确定是同一个人的声音') : tr('参照乙 · 确定与甲不同的声音')}</strong>
    {rows.length === 0 ? <p style={{ margin: '7px 0 0', color: color.secondary }}>{tr('试听下方片段后，点击“作为参照{v0}”', { v0: side === 'a' ? '甲' : '乙' })}</p> : rows.map(row => <div key={row.itemId} style={{ marginTop: 7, display: 'flex', alignItems: 'center', gap: 6 }}>
      <button type="button" style={button} disabled={!onPlay} onClick={() => onPlay?.(row)} aria-label={tr('试听参照{v0} {v1}', { v0: side === 'a' ? '甲' : '乙', v1: time(row.startAtMillis) })}>▶ {time(row.startAtMillis)}</button>
      <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={row.text}>{row.text}</span>
      <button type="button" style={{ ...button, padding: '2px 5px' }} aria-label={tr('移除参照 {v0}', { v0: time(row.startAtMillis) })} onClick={() => setReference(side, row.itemId)}>×</button>
    </div>)}
  </div>

  const originalPerson = options.find(option => option.optionKey === item.assignedSpeakerOptionKey && option.kind === 'speaker')
  if (saving && chosen[0]) return <ArkmeRecordingSpeakerCorrection item={chosen[0]} items={chosen} initialSelectedIds={chosen.map(row => row.itemId)}
    intent="review" rejectCurrent={!originalPerson && !!item.assignedSpeakerOptionKey && chosen[0].assignedSpeakerOptionKey === item.assignedSpeakerOptionKey}
    {...(originalPerson ? { target: { ...originalPerson, label: item.speakerLabel } } : {})} {...(onPlay ? { onPlay } : {})} onUpdated={onUpdated} onClose={onClose} onBack={() => setSaving(false)} />

  return <section style={{ display: 'flex', flexDirection: 'column', gap: 12, minHeight: 0, height: '100%', fontSize: 12, lineHeight: 1.5 }}>
    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}><strong style={{ flex: 1, fontSize: 15 }}>{tr('声音一致性')} <span style={{ fontWeight: 400, color: color.secondary }}>· {item.speakerLabel}</span></strong>
      <button type="button" style={button} onClick={onClose}>{tr('关闭')}</button></div>
    {!preview ? <>
      <div aria-label={tr('说话人整体一致性')} style={{ padding: '12px 14px', display: 'flex', alignItems: 'center', gap: 18, flexWrap: 'wrap', border: `1px solid ${color.border}`, borderRadius: 8 }}>
        <div><div style={{ color: color.secondary }}>{tr('整体一致性')}</div><strong style={{ fontSize: 28, fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>{tr(recordingConsistencyLabel(group, consistency.error))}</strong>{group?.score != null && <span style={{ color: color.tertiary }}> / 100</span>}</div>
        <div style={{ flex: 1, minWidth: 180, color: color.secondary }}><div>{group ? tr('当天已分析 {v0} / {v1} 段', { v0: group.analyzedCount, v1: group.totalCount }) : tr('当天完整分组 · 分析覆盖情况待返回')}</div>
          <div>{group?.reviewCount != null ? tr('{v0} 段待复核', { v0: group.reviewCount }) : tr('待复核数量待计算')}{group?.suspectedVoices && group.suspectedVoices > 1 ? ` · ${tr('可能混入多种声音')}` : ''}</div>
          <div style={{ marginTop: 4, fontSize: 11 }}>{tr('越高表示组内声音越一致，不代表人物身份准确率。')}</div></div>
        <button type="button" style={button} disabled={consistency.loading} onClick={consistency.reload}>{consistency.loading ? tr('读取中…') : tr('重新读取一致性')}</button>
      </div>
      {consistency.error && <div role="alert" style={{ color: color.danger }}>{consistency.error}</div>}
      {consistency.supported === false && <div style={{ color: color.secondary }}>{tr('一致性与偏离数据待后端提供；可先试听和选择片段。')}</div>}
      {group && <details><summary style={{ color: color.secondary, cursor: 'pointer' }}>{tr('指标口径与覆盖范围')}</summary><div>{tr('模型：')}{group.modelVersion} · {tr('版本：')}{group.version}</div><div>{tr('一致性定义：')}{group.scoreDefinition}</div><div>{tr('片段偏离参照：')}{group.referenceMethod}</div></details>}
      <div style={{ display: 'flex', gap: 7, alignItems: 'center', flexWrap: 'wrap' }}>
        <button type="button" style={button} aria-pressed={!nearby} onClick={() => { setNearby(false); setPage(0) }}>{tr('当天同组')}</button>
        <button type="button" style={button} aria-pressed={nearby} onClick={() => { setNearby(true); setPage(0) }}>{tr('附近片段')}</button>
        <span style={{ color: color.secondary }}>{nearby ? tr('前后 10 分钟，已加载 {v0} 段', { v0: candidates.length }) : group ? tr('已加载 {v0} 段 / 同组共 {v1} 处', { v0: candidates.length, v1: group.totalCount }) : tr('已加载 {v0} 段', { v0: candidates.length })}</span>
      </div>
      <div style={{ color: color.secondary }}>{tr('下方列出已加载片段；整体一致性按后台完整分组统计。系统同组不代表同一个人。')}</div>
      <div style={{ display: 'flex', gap: 7, alignItems: 'center', flexWrap: 'wrap' }}>
        <button type="button" style={button} aria-pressed={deviationFirst} onClick={() => { setDeviationFirst(true); setAdvanced(false) }}>{tr('本页偏离较大优先')}</button>
        <button type="button" style={button} aria-pressed={!deviationFirst} onClick={() => { setDeviationFirst(false); setAdvanced(false) }}>{tr('按时间')}</button>
        <button type="button" style={{ ...button, marginLeft: 'auto' }} aria-expanded={advanced} onClick={() => setAdvanced(!advanced)}>{advanced ? tr('收起甲乙参照对比') : tr('进一步核对 · 甲乙参照对比')}</button>
      </div>
      {advanced && <>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>{renderReference('a', referenceA)}{renderReference('b', referenceB)}</div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <button type="button" style={button} disabled={!onPlay || !a.length || !b.length} onClick={alternate}>{tr('交替试听 · 下一段{v0}', { v0: nextReference === 'a' ? '甲' : '乙' })}</button>
        <button type="button" style={button} disabled={!a.length || current?.loading} onClick={() => { void compare() }}>{current?.loading ? tr('读取中…') : tr('对比本页声纹')}</button>
        <span style={{ color: color.tertiary }}>{tr('每组最多 3 段参照；参照本身不计入识别结果。')}</span>
      </div>
      {current?.error && <div role="alert" style={{ color: color.danger }}>{current.error} <button type="button" style={button} onClick={() => { void compare() }}>{tr('重试')}</button></div>}
      <div role="status" style={{ padding: '8px 10px', borderRadius: 6, background: color.layer2, color: color.secondary }}>
        {current?.value?.supported === false ? tr('声纹证据接口暂未开放。可先试听、选择和预览；目前没有距离数据。')
          : value?.state === 'building' ? tr('本页声纹证据正在准备，稍后可重新对比。')
          : value ? tr('本页 {v0} / {v1} 段有可比较证据；距离越小越接近，不代表识别准确率。', { v0: value.items.filter(row => row.status === 'ready' && ![...input.referenceA, ...input.referenceB].includes(row.itemRef)).length, v1: pageItems.filter(row => !references.has(row.itemId)).length })
          : a.length ? tr('参照或页面变化后，请重新对比本页声纹。') : tr('先试听并选取参照甲；有参照乙时，可以比较两种声音。')}
      </div>
      {value?.state === 'ready' && <>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
          {([['all', '全部'], ['a', '较接近甲'], ['b', '较接近乙'], ['ambiguous', '难以区分'], ['insufficient', '证据不足']] as const).map(([key, label]) => <button type="button" key={key} style={button} aria-pressed={filter === key} onClick={() => setFilter(key)}>{tr(label)}</button>)}
          <label style={{ marginLeft: 'auto' }}><input type="checkbox" checked={suspiciousFirst} onChange={event => setSuspiciousFirst(event.target.checked)} /> {tr('优先看存疑')}</label>
        </div>
        <details><summary style={{ cursor: 'pointer', color: color.secondary }}>{tr('查看距离依据与审查线')}</summary>
          <p>{tr('模型：')}{value.modelVersion} · {tr('证据版本：')}{value.version} · {tr('余弦距离，范围 0–2')}</p>
          <p>{tr('参照计算：')}{tr(value.aggregation === 'nearest_reference' ? '最近参照片段' : value.aggregation === 'mean_reference' ? '参照距离平均值' : '参照中心距离')}{value.ambiguityMargin !== undefined && <> · {tr('难区分差距：')}{value.ambiguityMargin.toFixed(3)}</>}</p>
          <label>{tr('审查线：')}{reviewLine === undefined ? tr('未启用') : reviewLine.toFixed(3)} <input aria-label={tr('审查线')} type="range" min="0" max="2" step="0.01" value={reviewLine ?? 2} onChange={event => setReviewLine(Number(event.target.value))} /></label>
          <button type="button" style={button} onClick={() => setReviewLine(undefined)}>{tr('清除高亮')}</button>
          <p>{tr('只高亮距甲超过审查线的片段，不改系统归并阈值，不自动选择或保存。')}</p>
        </details>
      </>}
      </>}
      <div ref={listRef} style={{ minHeight: 0, flex: 1, overflow: 'auto', border: `1px solid ${color.border}`, borderRadius: 8 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }} aria-label={tr('声音核对片段')}><colgroup><col style={{ width: 36 }} /><col /><col style={{ width: advanced ? 52 : 95 }} />{advanced && <><col style={{ width: 52 }} /><col style={{ width: 52 }} /></>}</colgroup><thead style={{ position: 'sticky', top: 0, zIndex: 1, background: color.base }}><tr>
          {(advanced ? ['选择', '片段与原文', '距甲', '距乙', '差距'] : ['选择', '片段与原文', '偏离距离']).map(label => <th key={label} style={{ padding: '8px 6px', whiteSpace: 'nowrap', textAlign: label === '片段与原文' ? 'left' : 'center', color: color.secondary, fontWeight: 400 }}>{tr(label)}</th>)}
        </tr></thead><tbody>{visible.map(row => {
          const score = scores.get(row.itemRef), isReference = references.has(row.itemId)
          const diff = score?.distanceA != null && score.distanceB != null ? Math.abs(score.distanceA - score.distanceB) : null
          const highlighted = advanced && !isReference && reviewLine !== undefined && score?.distanceA != null && score.distanceA > reviewLine
          return <tr key={row.itemId} style={{ borderTop: `1px solid ${color.border}`, background: highlighted ? color.layer2 : 'transparent' }}>
            <td style={{ padding: 7, verticalAlign: 'top' }}><input type="checkbox" aria-label={tr('选择 {v0} 片段', { v0: time(row.startAtMillis) })} checked={selected.has(row.itemId)} disabled={a.includes(row.itemId) || (!selected.has(row.itemId) && selected.size >= 100)} onChange={event => { const checked = event.target.checked; setSelected(old => { const next = new Set(old); if (checked) next.add(row.itemId); else next.delete(row.itemId); return next }) }} /></td>
            <td style={{ padding: '8px 5px', minWidth: 180 }}><div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6, color: color.secondary }}>
              <time>{time(row.startAtMillis)}</time><span>{row.speakerLabel}</span>{row.soundSource === 'playback' && <span>{tr('播放内容')}</span>}
              {a.includes(row.itemId) && <strong>{tr('参照甲')}</strong>}{b.includes(row.itemId) && <strong>{tr('参照乙')}</strong>}
              <button type="button" style={{ ...button, padding: '2px 6px' }} disabled={!onPlay} aria-label={tr('试听片段 {v0}', { v0: time(row.startAtMillis) })} onClick={() => onPlay?.(row)}>{tr('试听')}</button>
            </div><p style={{ margin: '6px 0', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{row.text}</p>
              {advanced ? <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap' }}>{(['a', 'b'] as const).map(side => <button key={side} type="button" style={{ ...button, padding: '2px 6px' }} aria-pressed={(side === 'a' ? a : b).includes(row.itemId)} disabled={(side === 'a' ? a : b).length >= 3 && !(side === 'a' ? a : b).includes(row.itemId)} onClick={() => setReference(side, row.itemId)}>{tr('作为参照{v0}', { v0: side === 'a' ? '甲' : '乙' })}</button>)}
                <span style={{ color: color.tertiary }}>{isReference ? tr('参照不参与自我判断') : score ? score.reason || tr('有效语音 {v0} 秒', { v0: (score.effectiveSpeechMillis / 1000).toFixed(1) }) : tr('尚无声纹证据')}</span>
              </div> : deviations.get(row.itemRef)?.reason && <small style={{ color: color.tertiary }}>{deviations.get(row.itemRef)?.reason}</small>}
            </td>
            {(advanced ? [score?.distanceA, score?.distanceB, diff] : [deviations.get(row.itemRef)?.deviation]).map((number, index) => <td key={index} style={{ textAlign: 'center', verticalAlign: 'top', padding: '11px 7px', whiteSpace: 'nowrap', fontFamily: 'monospace', fontVariantNumeric: 'tabular-nums', color: color.secondary }}>{(advanced && isReference) || number == null ? '—' : number.toFixed(3)}</td>)}
          </tr>
        })}</tbody></table>
        {visible.length === 0 && <p style={{ padding: 12, color: color.secondary }}>{tr('本页没有符合条件的片段。')}</p>}
      </div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <button type="button" style={button} disabled={pageIndex === 0} onClick={() => setPage(pageIndex - 1)}>{tr('上一页')}</button>
        <span style={{ color: color.secondary }}>{pageIndex + 1} / {pages} · {tr('每页最多 50 段')}</span>
        <button type="button" style={button} disabled={pageIndex >= pages - 1} onClick={() => setPage(pageIndex + 1)}>{tr('下一页')}</button>
        <span style={{ marginLeft: 'auto', color: color.secondary }}>{tr('已选 {v0} 段', { v0: chosen.length })}</span>
        <button type="button" style={button} disabled={chosen.length === 0} onClick={() => setPreview(true)}>{tr('预览处理结果')}</button>
      </div>
    </> : <>
      <div style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
        <p>{tr('仅处理已选 {v0} 段。参照选择和距离筛选不会扩大本次范围。', { v0: chosen.length })}</p>
        {chosen.map(row => <div key={row.itemId} style={{ padding: '7px 0', borderBottom: `1px solid ${color.border}` }}><time style={{ color: color.secondary }}>{time(row.startAtMillis)}</time> {row.text}</div>)}
        <fieldset style={{ border: 0, padding: '12px 0' }}><legend>{tr('处理方式')}</legend>
          {([['unknown', '从原分组拆出，暂不确定是谁'], ['existing', '改为已有的人物'], ['new', '作为新的说话人']] as const).map(([mode, label]) => <label key={mode} style={{ display: 'block', margin: '8px 0' }}><input type="radio" name="speaker-review-target" checked={targetMode === mode} onChange={() => setTargetMode(mode)} /> {tr(label)}</label>)}
        </fieldset>
        {targetMode === 'existing' && <select aria-label={tr('目标人物')} value={targetKey} onChange={event => setTargetKey(event.target.value)} style={{ ...button, maxWidth: '100%' }}><option value="">{tr('选择已有的人物')}</option>{options.map(option => <option key={option.optionKey} value={option.optionKey}>{option.label}</option>)}</select>}
        {targetMode === 'new' && <input aria-label={tr('新说话人名称')} value={newName} maxLength={50} onChange={event => setNewName(event.target.value)} placeholder={tr('输入名称')} style={button} />}
        <p style={{ color: color.secondary }}>{targetMode === 'unknown' ? tr('下一步确认声音来源和排除人物。选中多段不代表它们属于同一个人。') : tr('此方式暂为处理预览，需要后端支持原子拆分与归属保存；尚未修改任何人物。')}</p>
        {targetMode !== 'unknown' && <p>{tr('预览目标：')}{targetMode === 'new' ? newName.trim() || tr('尚未填写') : options.find(option => option.optionKey === targetKey)?.label || tr('尚未选择')}</p>}
      </div>
      <div style={{ display: 'flex', gap: 8, justifyContent: 'space-between', borderTop: `1px solid ${color.border}`, paddingTop: 10 }}><button type="button" style={button} onClick={() => setPreview(false)}>{tr('返回核对')}</button>
        <button type="button" style={button} disabled={targetMode !== 'unknown' || chosen.length === 0} onClick={() => setSaving(true)}>{targetMode === 'unknown' ? tr('确认范围，继续纠错') : tr('等待后端支持保存')}</button></div>
    </>}
  </section>
}
