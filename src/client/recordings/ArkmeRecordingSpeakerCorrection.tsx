import { useEffect, useRef, useState, type CSSProperties } from 'react'
import type { ArkmeRecordingDay, ArkmeRecordingSoundSource, ArkmeRecordingSpeakerCandidate, ArkmeRecordingSpeakerCorrectionInput, ArkmeRecordingSpeakerCorrectionUndoInput, ArkmeRecordingSpeakerCorrectionResult, ArkmeRecordingWorkbenchItem } from '../../types.js'
import { callArkme } from '../api.js'
import { ArkmeClientError } from '../../sdk/index.js'
import { arkmeAuthStore } from '../auth-store.js'
import { arkmeTheme as color } from '../arkme-theme.js'
import { tr } from '../locale.js'
import { resetRecordingSpeakerCaches } from './recording-speaker-options-store.js'
import { useRecordingSpeakerCorrection } from './use-recording-speaker-correction.js'

const button: CSSProperties = { border: `1px solid ${color.border}`, borderRadius: 6, padding: '6px 9px', background: color.base, color: color.text, font: 'inherit', fontSize: 12, cursor: 'pointer' }
const time = (stamp: number) => new Date(stamp).toLocaleTimeString('zh-CN', { hour12: false })

/** Nearby is temporal context for manual review, never an assertion of voice similarity. */
export function nearbyCorrectionItems(items: readonly ArkmeRecordingWorkbenchItem[], anchor: ArkmeRecordingWorkbenchItem) {
  const nearby = items.filter(item => item.transcriptSource === anchor.transcriptSource && Math.abs(item.startAtMillis - anchor.startAtMillis) <= 10 * 60_000)
    .sort((a, b) => Math.abs(a.startAtMillis - anchor.startAtMillis) - Math.abs(b.startAtMillis - anchor.startAtMillis)).slice(0, 100)
  if (!nearby.some(item => item.itemId === anchor.itemId)) nearby.unshift(anchor)
  return nearby.slice(0, 100).sort((a, b) => a.startAtMillis - b.startAtMillis)
}

export function ArkmeRecordingSpeakerCorrection({ item, items, target, rejectCurrent, intent, autoReject = false, initialSelectedIds, onUpdated, onClose, onPlay, onBack }: {
  item: ArkmeRecordingWorkbenchItem
  items: readonly ArkmeRecordingWorkbenchItem[]
  target?: Pick<ArkmeRecordingSpeakerCandidate, 'label' | 'speakerRef' | 'optionKey'>
  rejectCurrent: boolean
  intent: 'reject' | 'source' | 'review'
  autoReject?: boolean
  /** Explicit selection from evidence review; never infer membership by time or name. */
  initialSelectedIds?: string[]
  onUpdated(day: ArkmeRecordingDay): void
  onClose(): void
  onBack?(): void
  onPlay?(item: ArkmeRecordingWorkbenchItem): void
}) {
  const [currentItem, setCurrentItem] = useState(item)
  const [availableItems, setAvailableItems] = useState(items)
  const correction = useRecordingSpeakerCorrection(currentItem.itemRef)
  const context = correction.context
  const [exclude, setExclude] = useState(intent === 'reject')
  const [source, setSource] = useState<ArkmeRecordingSoundSource | ''>('')
  const [detach, setDetach] = useState(intent === 'reject' || intent === 'review')
  const [review, setReview] = useState(intent === 'review')
  const [selected, setSelected] = useState(new Set(initialSelectedIds ? [item.itemId, ...initialSelectedIds.filter(id => items.some(row => row.itemId === id))] : [item.itemId]))
  const [activity, setActivity] = useState<'write' | 'read'>()
  const pending = activity !== undefined
  const [error, setError] = useState('')
  const [outcomeUnknown, setOutcomeUnknown] = useState(false)
  const [receipt, setReceipt] = useState<ArkmeRecordingSpeakerCorrectionResult>()
  const [notice, setNotice] = useState('')
  const mounted = useRef(true)
  const locked = useRef(false)
  const autoStarted = useRef(false)
  const attempt = useRef<{ signature: string; key: string }>()
  const unresolved = useRef<{ action: 'apply'; input: ArkmeRecordingSpeakerCorrectionInput } | { action: 'undo'; input: ArkmeRecordingSpeakerCorrectionUndoInput }>()
  const recovering = unresolved.current !== undefined
  const initialAccount = useRef(arkmeAuthStore.getSnapshot().auth)
  useEffect(() => {
    mounted.current = true
    const unsubscribe = arkmeAuthStore.subscribe(() => {
      const auth = arkmeAuthStore.getSnapshot().auth, initial = initialAccount.current
      if (auth?.userId !== initial?.userId || auth?.environment !== initial?.environment || auth?.status !== initial?.status) { mounted.current = false; onClose() }
    })
    return () => { mounted.current = false; unsubscribe() }
  }, [])
  const candidates = initialSelectedIds ? availableItems : nearbyCorrectionItems(availableItems, currentItem)
  const personLabel = target?.label ?? (rejectCurrent ? item.speakerLabel : '')
  const maxItems = context?.supported ? context.maxItems : 100
  const canSave = !pending && !outcomeUnknown && (recovering ? unresolved.current?.action === 'apply' : context?.supported === true && selected.size > 0 && selected.size <= maxItems
    && ((exclude && !!personLabel) || source !== '' || detach))
  const finish = (result: ArkmeRecordingSpeakerCorrectionResult, undo = false) => {
    unresolved.current = undefined; attempt.current = undefined; setOutcomeUnknown(false); setError('')
    resetRecordingSpeakerCaches()
    setReceipt(result)
    setNotice(undo ? tr('已撤销这次纠错') : tr('已保存 {v0} 段纠错', { v0: result.affectedCount }))
    if (result.day) onUpdated(result.day)
    const transcript = result.transcript ?? result.day?.transcript
    if (transcript) {
      setAvailableItems(initialSelectedIds ? transcript.items.filter(row => row.itemId === item.itemId || initialSelectedIds.includes(row.itemId)) : transcript.items)
      setCurrentItem(transcript.items.find(row => row.itemId === item.itemId) ?? currentItem)
    }
    correction.reload()
  }
  const fail = (reason: unknown, fallback: string) => {
    if (!mounted.current) return
    const rejected = reason instanceof ArkmeClientError && reason.body.code === 'recording-correction-rejected'
    if (rejected) unresolved.current = undefined
    setError(reason instanceof Error ? reason.message : fallback)
    setOutcomeUnknown(!rejected)
  }
  const submit = async (command: NonNullable<typeof unresolved.current>) => {
    locked.current = true; setActivity('write'); setError(''); unresolved.current = command
    try {
      const result = await callArkme<ArkmeRecordingSpeakerCorrectionResult>(`recordings.speaker.correction.${command.action}`, { ...command.input })
      if (mounted.current) finish(result, command.action === 'undo')
    } catch (reason) { fail(reason, tr(command.action === 'undo' ? '撤销失败' : '纠错保存失败')) }
    finally { locked.current = false; if (mounted.current) setActivity(undefined) }
  }
  const save = async () => {
    if (!canSave || locked.current) return
    if (unresolved.current?.action === 'apply') { await submit(unresolved.current); return }
    if (!context?.supported) return
    const input = { itemRef: currentItem.itemRef,
      itemRefs: availableItems.filter(row => selected.has(row.itemId)).map(row => row.itemRef),
      expectedVersion: context.version, detach,
      ...(exclude && rejectCurrent ? { rejectCurrent: true } : {}),
      ...(exclude && !rejectCurrent && target ? { rejectedSpeakerRef: target.speakerRef } : {}),
      ...(source === '' ? {} : { soundSource: source }) }
    if (input.itemRefs.length === 0 && selected.has(currentItem.itemId)) input.itemRefs.push(currentItem.itemRef)
    const signature = JSON.stringify(input)
    if (attempt.current?.signature !== signature) attempt.current = { signature, key: crypto.randomUUID() }
    await submit({ action: 'apply', input: { ...input, idempotencyKey: attempt.current.key } })
  }
  const undo = async () => {
    if (pending || locked.current || outcomeUnknown) return
    if (unresolved.current) {
      if (unresolved.current.action === 'undo') await submit(unresolved.current)
      return
    }
    const undoRef = receipt ? receipt.undoRef : (context?.supported ? context.undoRef : undefined)
    const version = context?.supported ? context.version : receipt?.version
    if (!undoRef || !version) return
    await submit({ action: 'undo', input: { itemRef: currentItem.itemRef, undoRef, expectedVersion: version, idempotencyKey: crypto.randomUUID() } })
  }
  const reload = async () => {
    const command = unresolved.current
    if (!command) { correction.reload(); return }
    if (pending || locked.current) return
    locked.current = true; setActivity('read')
    try {
      const result = await callArkme<ArkmeRecordingSpeakerCorrectionResult | null>('recordings.speaker.correction.result', {
        itemRef: command.input.itemRef, action: command.action, idempotencyKey: command.input.idempotencyKey,
      })
      if (!mounted.current) return
      if (result) finish(result, command.action === 'undo')
      else {
        // No receipt may mean still in flight. Keep the exact selection frozen;
        // only a new click on the original save/undo button may replay it.
        setOutcomeUnknown(false)
        setError(tr('尚未查到已完成的回执。'))
      }
    } catch (reason) {
      if (mounted.current) { setOutcomeUnknown(true); setError(reason instanceof Error ? reason.message : tr('暂时无法读取保存结果')) }
    } finally { locked.current = false; if (mounted.current) setActivity(undefined) }
  }
  useEffect(() => {
    // Only a click made while the capability was already known ready can submit automatically.
    if (autoReject && !autoStarted.current && context?.supported) { autoStarted.current = true; void save() }
  }, [context])
  const resetForReview = () => {
    setReceipt(undefined); setNotice(''); setReview(true); setSelected(new Set([currentItem.itemId]));
    setExclude(false); setSource(''); setDetach(true)
  }
  const undoRef = receipt ? receipt.undoRef : (context?.supported ? context.undoRef : undefined)
  return <section aria-label={tr('说话人纠错')} style={{ display: 'flex', flexDirection: 'column', minHeight: 0, gap: 10, fontSize: 12 }}>
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
      <strong style={{ fontSize: 14 }}>{tr('纠正说话人')}</strong>
      {onBack && <button type="button" style={button} disabled={pending || outcomeUnknown || !!notice} onClick={onBack}>{tr('返回核对')}</button>}
      <button type="button" style={button} disabled={pending} onClick={onClose}>{tr('关闭')}</button>
    </div>
    <div style={{ color: color.secondary }}>{time(currentItem.startAtMillis)} · {initialSelectedIds ? tr('仅处理手动选择的 {v0} 段', { v0: selected.size }) : tr('默认仅处理当前片段')}</div>
    {correction.loading && <div role="status">{tr('正在读取纠错状态…')}</div>}
    {context?.supported === false && <div role="status" style={{ padding: 9, borderRadius: 6, background: color.layer2, lineHeight: 1.6 }}>
      {tr('说话人纠错暂未开放。可以先查看和选择，当前选择尚未保存。')}
    </div>}
    {correction.error && <div role="alert" style={{ color: color.danger }}>{correction.error} <button style={button} onClick={correction.reload}>{tr('重试读取')}</button></div>}
    {context?.supported && context.excludedSpeakers.length > 0 && <div style={{ color: color.secondary }}>{tr('已排除：')}{context.excludedSpeakers.map(person => person.label).join('、')}</div>}
    {notice ? <>
      <div role="status" style={{ padding: 10, borderRadius: 6, background: color.layer2 }}>{notice}{receipt?.warning && <p>{receipt.warning}</p>}</div>
      <div style={{ display: 'flex', gap: 8 }}>
        {undoRef && <button style={button} disabled={pending || outcomeUnknown || unresolved.current?.action === 'apply' || correction.loading} onClick={() => { void undo() }}>{tr('撤销这次纠错')}</button>}
        <button style={button} disabled={pending || recovering || correction.loading} onClick={resetForReview}>{tr('核对附近片段')}</button>
      </div>
    </> : <>
      <div style={{ overflowY: 'auto', minHeight: 0, maxHeight: 'min(510px, 55vh)', display: 'flex', flexDirection: 'column', gap: 12 }}>
        {personLabel && <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <input type="checkbox" aria-label={tr('不是 {v0}', { v0: personLabel })} checked={exclude} disabled={pending || recovering} onChange={event => { setExclude(event.target.checked); if (event.target.checked) setDetach(true) }} />
          {tr('这些片段不是 {v0}', { v0: personLabel })}
        </label>}
        <fieldset disabled={pending || recovering} style={{ border: 0, margin: 0, padding: 0 }}>
          <legend style={{ marginBottom: 7 }}>{tr('声音来源')}{context?.supported && <span style={{ color: color.tertiary }}> · {tr(context.soundSource === 'playback' ? '当前：播放内容' : context.soundSource === 'in_person' ? '当前：现场' : '当前：不确定')}</span>}</legend>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {([['', '保持原样'], ['in_person', '现场'], ['playback', '手机 / 电视播放'], ['unknown', '不确定']] as const).map(([value, label]) =>
              <button key={value} type="button" aria-pressed={source === value} style={{ ...button, ...(source === value ? { background: color.layer2, borderColor: color.info } : {}) }} onClick={() => { setSource(value) }}>{tr(label)}</button>)}
          </div>
        </fieldset>
        <label style={{ display: 'flex', gap: 6, alignItems: 'flex-start' }}><input type="checkbox" aria-label={tr('从原说话人分组中拆出')} checked={detach} disabled={pending || recovering || exclude} onChange={event => { setDetach(event.target.checked) }} />
          <span>{tr('从原说话人分组中拆出')}<small style={{ display: 'block', color: color.secondary, marginTop: 4, lineHeight: 1.6 }}>{tr('保留转写，身份待确认；选中多段不代表它们是同一个人。')}</small></span>
        </label>
        {!review ? <button style={button} disabled={pending || recovering} onClick={() => { setReview(true) }}>{tr('核对附近片段')}</button> : <>
          <div style={{ color: color.secondary, lineHeight: 1.6 }}>{initialSelectedIds ? tr('仅包含核对面板中手动选中的片段，最多 100 段。仍可取消勾选；不会扩大到整个分组。') : tr('前后 10 分钟，最多 100 段。请试听后手动勾选；附近不代表同一个人。')}</div>
          <ul style={{ listStyle: 'none', margin: 0, padding: 0 }} aria-label={tr('待核对片段')}>
            {candidates.map(row => <li key={row.itemId} style={{ display: 'flex', gap: 7, padding: '9px 3px', borderBottom: `1px solid ${color.border}`, alignItems: 'flex-start' }}>
              <input type="checkbox" aria-label={tr('选择 {v0} 片段', { v0: time(row.startAtMillis) })} checked={selected.has(row.itemId)} disabled={pending || recovering || row.itemId === currentItem.itemId || (!selected.has(row.itemId) && selected.size >= maxItems)}
                onChange={event => { const checked = event.target.checked; setSelected(old => { const next = new Set(old); if (checked) next.add(row.itemId); else next.delete(row.itemId); return next }) }} />
              <div style={{ flex: 1, minWidth: 0 }}><div style={{ display: 'flex', gap: 5, alignItems: 'center', color: color.secondary }}><time>{time(row.startAtMillis)}</time><span>{row.speakerLabel}</span><button type="button" style={{ ...button, marginLeft: 'auto', padding: '2px 6px' }} disabled={!onPlay} aria-label={tr('试听 {v0}', { v0: time(row.startAtMillis) })} onClick={() => { onPlay?.(row) }}>{tr('试听')}</button></div>
                <p style={{ margin: '5px 0 0', lineHeight: 1.6, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{row.text}</p></div>
            </li>)}
          </ul>
        </>}
      </div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', borderTop: `1px solid ${color.border}`, paddingTop: 10 }}>
        <span style={{ color: color.secondary, flex: 1 }}>{tr('已选 {v0} 段', { v0: selected.size })}</span>
        {undoRef && <button style={button} disabled={pending || outcomeUnknown || unresolved.current?.action === 'apply' || correction.loading} onClick={() => { void undo() }}>{tr('撤销上次纠错')}</button>}
        <button type="button" style={{ ...button, background: canSave ? color.text : color.layer2, color: canSave ? color.base : color.tertiary }} disabled={!canSave || correction.loading} onClick={() => { void save() }}>{pending ? tr(activity === 'read' ? '读取中…' : '保存中…') : tr('保存纠错')}</button>
      </div>
    </>}
    {error && <div role="alert" style={{ color: color.danger, lineHeight: 1.6 }}>{error}<div>{tr(outcomeUnknown ? '请先重新读取状态，确认是否已保存。' : recovering ? (unresolved.current?.action === 'undo' ? '可继续读取状态，或点击撤销按钮重试原请求。' : '可继续读取状态，或点击保存纠错重试原请求。') : '本次操作未保存，请重新打开录音，再核对所选片段。')}</div>
      <button style={button} disabled={pending || correction.loading} onClick={() => { void reload() }}>{tr('重新读取状态')}</button>
    </div>}
  </section>
}
