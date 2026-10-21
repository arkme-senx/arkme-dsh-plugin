import { PersonPicker } from '../explore/PersonPicker.js'
import { tr, useArkmeLocale } from '../locale.js'
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import { Check } from '@phosphor-icons/react/dist/icons/Check'
import { Plus } from '@phosphor-icons/react/dist/icons/Plus'
import { Play } from '@phosphor-icons/react/dist/icons/Play'
import type { ArkmeRecordingDay, ArkmeRecordingSpeakerOption, ArkmeRecordingWorkbenchItem } from '../../types.js'
import { ArkmeUserAvatar } from '../ArkmeAvatar.js'
import { useRecordingSpeakerOptions } from './use-recording-speaker-options.js'
import { arkmeTheme } from '../arkme-theme.js'
import { useRecordingSpeakerCorrection } from './use-recording-speaker-correction.js'
import { ArkmeRecordingSpeakerCorrection } from './ArkmeRecordingSpeakerCorrection.js'
import { ArkmeRecordingSpeakerReview } from './ArkmeRecordingSpeakerReview.js'
import { recordingConsistencyLabel, useRecordingConsistency } from './use-recording-consistency.js'

const desktop = {
  base: arkmeTheme.base, hover: arkmeTheme.hover, border: arkmeTheme.border, text: arkmeTheme.text,
  secondary: arkmeTheme.secondary, tertiary: arkmeTheme.tertiary, blue: arkmeTheme.info,
  danger: arkmeTheme.danger, avatar: arkmeTheme.layer2,
}

const styles: Record<string, CSSProperties> = {
  backdrop: { position: 'fixed', zIndex: 1_019, inset: 0, padding: 0, border: 0, background: 'transparent', cursor: 'default' },
  popover: { position: 'fixed', zIndex: 1_020, width: 278, maxHeight: 'calc(100vh - 16px)', display: 'flex', flexDirection: 'column', padding: 8, boxSizing: 'border-box', border: `1px solid ${desktop.border}`, borderRadius: 8, background: desktop.base, boxShadow: '0 4px 16px rgba(0,0,0,.1)', color: desktop.text },
  current: { display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0, minHeight: 32, padding: '0 4px 8px', marginBottom: 8, borderBottom: `1px solid ${desktop.border}`, fontSize: 12 },
  field: { width: '100%', flexShrink: 0, height: 30, boxSizing: 'border-box', padding: '6px 10px', border: `1px solid ${desktop.tertiary}`, borderRadius: 4, background: desktop.base, color: desktop.text, outline: 0, font: 'inherit', fontSize: 12, lineHeight: '16px' },
  list: { maxHeight: 288, minHeight: 0, marginTop: 6, overflowY: 'auto' },
  title: { height: 23, padding: '4px 8px', boxSizing: 'border-box', display: 'flex', alignItems: 'center', justifyContent: 'space-between', position: 'sticky', top: 0, zIndex: 1, background: desktop.base, color: desktop.tertiary, fontSize: 10, lineHeight: '15px' },
  option: { width: '100%', minHeight: 32, marginBottom: 4, padding: '4px 8px', display: 'flex', alignItems: 'center', gap: 8, border: 0, borderRadius: 4, background: 'transparent', color: desktop.text, cursor: 'pointer', textAlign: 'left', font: 'inherit', fontSize: 14, lineHeight: '16px' },
  avatar: { width: 24, height: 24, flex: 'none', display: 'grid', placeItems: 'center', borderRadius: '50%', background: desktop.avatar, color: desktop.secondary, fontSize: 12, fontWeight: 600 },
  optionLabel: { minWidth: 0, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  add: { width: '100%', minHeight: 28, padding: '2px 8px', display: 'flex', alignItems: 'center', gap: 8, border: 0, borderRadius: 4, background: 'transparent', color: desktop.blue, cursor: 'pointer', textAlign: 'left', fontSize: 12 },
  bottom: { minHeight: 42, flexShrink: 0, marginTop: 2, paddingTop: 6, display: 'flex', alignItems: 'center', gap: 5, borderTop: `1px solid ${desktop.border}` },
  scope: { display: 'flex', gap: 3, flexShrink: 0, marginTop: 8, padding: 3, borderRadius: 6, background: desktop.hover },
  scopeOption: { flex: 1, padding: '6px 4px', border: 0, borderRadius: 4, font: 'inherit', fontSize: 12, lineHeight: '16px', cursor: 'pointer', color: desktop.secondary, background: 'transparent' },
  scopeHint: { minWidth: 0, flex: 1, color: desktop.secondary, fontSize: 11, lineHeight: '16px' },
  confirm: { flexShrink: 0, padding: '7px 10px', border: 0, borderRadius: 8, background: desktop.text, color: desktop.base, cursor: 'pointer', font: 'inherit', fontSize: 12, lineHeight: '16px' },
  unassign: { padding: '5px 0', border: 0, background: 'transparent', color: desktop.danger, cursor: 'pointer', fontSize: 11 },
  error: { marginTop: 6, color: desktop.danger, fontSize: 11, lineHeight: '16px' },
}

export interface RecordingSpeakerPopoverAnchor {
  left: number
  right: number
  top: number
  bottom: number
}

const SPEAKER_POPOVER_WIDTH = 278
const SPEAKER_POPOVER_ESTIMATED_HEIGHT = 380
const SPEAKER_POPOVER_GAP = 8
const SPEAKER_POPOVER_MARGIN = 8

export function recordingSpeakerPopoverPosition(
  anchor: RecordingSpeakerPopoverAnchor,
  viewport: { width: number; height: number },
): { left: number; top: number } {
  const left = Math.min(
    Math.max(SPEAKER_POPOVER_MARGIN, anchor.left),
    Math.max(SPEAKER_POPOVER_MARGIN, viewport.width - SPEAKER_POPOVER_WIDTH - SPEAKER_POPOVER_MARGIN),
  )
  const below = anchor.bottom + SPEAKER_POPOVER_GAP
  const above = anchor.top - SPEAKER_POPOVER_GAP - SPEAKER_POPOVER_ESTIMATED_HEIGHT
  const top = below + SPEAKER_POPOVER_ESTIMATED_HEIGHT <= viewport.height - SPEAKER_POPOVER_MARGIN
    ? below
    : Math.max(SPEAKER_POPOVER_MARGIN, above)
  return { left, top }
}

export function categorizeRecordingSpeakerOptions(options: readonly ArkmeRecordingSpeakerOption[], query: string) {
  const normalized = query.trim().toLocaleLowerCase('zh-CN')
  const visible = normalized === '' ? options : options.filter(option => option.label.toLocaleLowerCase('zh-CN').includes(normalized))
  const recommended = visible.filter(option => option.recommended)
  const recommendedRefs = new Set(recommended.map(option => option.optionKey))
  return {
    recommended,
    speakers: visible.filter(option => !recommendedRefs.has(option.optionKey) && option.kind === 'speaker'),
    users: visible.filter(option => !recommendedRefs.has(option.optionKey) && option.kind === 'arkme-user'),
  }
}

function SpeakerOptionRow({ option, selected, disabled, onClick }: {
  option: ArkmeRecordingSpeakerOption
  selected: boolean
  disabled: boolean
  onClick(): void
}) {
  return <button data-arkme-feedback="neutral" type="button" disabled={disabled} data-speaker-option-key={option.optionKey} aria-pressed={selected} style={{ ...styles.option, ...(selected ? { background: desktop.hover } : {}), ...(disabled ? { cursor: 'default' } : {}) }} onClick={onClick}>
    {option.avatarRef === undefined
      ? <span style={{ ...styles.avatar, ...(selected ? { boxShadow: '0 0 0 1px rgba(9,184,62,.3)' } : {}) }}>{option.label.slice(0, 1) || '声'}</span>
      : <ArkmeUserAvatar avatarRef={option.avatarRef} size={24} label={tr("{v0}的头像", { v0: option.label })} />}
    <span style={styles.optionLabel}>{option.label}{option.isCurrentUser ? '（我）' : ''}</span>
    {selected && <Check size={14} aria-label={tr("已选择")} />}
  </button>
}

function SpeakerSection({ title, options, selected, disabled, onSelect }: {
  title: string
  options: readonly ArkmeRecordingSpeakerOption[]
  selected: string
  disabled: boolean
  onSelect(option: ArkmeRecordingSpeakerOption): void
}) {
  if (options.length === 0) return null
  return <section><div style={styles.title}><span>{title}</span><span>{options.length}</span></div>{options.map(option => <SpeakerOptionRow key={option.optionKey} option={option} disabled={disabled} selected={selected === option.optionKey} onClick={() => { onSelect(option) }} />)}</section>
}

export interface RecordingSpeakerUpdateFeedback {
  itemId: string
  scope: 'item' | 'speaker'
  count: number
  warning?: string
}

export function ArkmeRecordingSpeakerEditor({ item, items = [item], anchor, initialBatchUpdate = false, initialReview = false, onUpdated, onClose, onPlay }: {
  items?: readonly ArkmeRecordingWorkbenchItem[]
  onPlay?(item: ArkmeRecordingWorkbenchItem): void
  item: ArkmeRecordingWorkbenchItem
  anchor?: RecordingSpeakerPopoverAnchor
  initialBatchUpdate?: boolean
  initialReview?: boolean
  onUpdated(day: ArkmeRecordingDay, removal?: RecordingSpeakerUpdateFeedback): void
  onClose(): void
}) {
  useArkmeLocale()
  const { contextKey: key, options: allOptions, loading, error: optionsError, ready: optionsReady, pending, refresh, save, savePerson, accountScope, unassign } = useRecordingSpeakerOptions(item)
  const correction = useRecordingSpeakerCorrection(item.itemRef)
  const excludedKeys = correction.context?.supported ? correction.context.excludedSpeakers.map(person => person.optionKey) : []
  const options = useMemo(() => allOptions.map(option => ({ ...option, recommended: option.recommended && !correction.loading && !correction.error && !excludedKeys.includes(option.optionKey) })), [allOptions, correction.context, correction.loading, correction.error])
  const correctionTarget = item.assignedSpeakerOptionKey ? options.find(option => option.currentAssignment) : options.find(option => option.recommended)
  const correctionPersonLabel = item.assignedSpeakerOptionKey ? item.speakerLabel : correctionTarget?.label
  const [correctionIntent, setCorrectionIntent] = useState<'reject' | 'source' | 'review'>()
  const [autoReject, setAutoReject] = useState(false)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [pickedPerson, setPickedPerson] = useState<{ label: string; speakerRef: string }>()
  const [reviewOpen, setReviewOpen] = useState(initialReview)
  const consistency = useRecordingConsistency(reviewOpen ? [] : [item.itemRef])
  const correctionChoice = useRef<{ target: typeof correctionTarget; rejectCurrent: boolean }>({ target: undefined, rejectCurrent: false })
  const openCorrection = (intent: 'reject' | 'source' | 'review') => {
    correctionChoice.current = { target: correctionTarget, rejectCurrent: !!item.assignedSpeakerOptionKey && !correctionTarget }
    setAutoReject(intent === 'reject' && correction.context?.supported === true)
    setCorrectionIntent(intent)
  }
  const popoverRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef(typeof document === 'undefined' ? null : document.activeElement)
  const selectionTouched = useRef(false)
  const viewGeneration = useRef(0)
  const [selected, setSelected] = useState('')
  const [query, setQuery] = useState('')
  const [batch, setBatch] = useState(initialBatchUpdate)
  const [mutationError, setMutationError] = useState('')
  const [removing, setRemoving] = useState(false)
  const categories = useMemo(() => categorizeRecordingSpeakerOptions(options, query), [options, query])
  const newSpeakerName = query.trim()
  const normalizedNewSpeakerName = newSpeakerName.toLocaleLowerCase('zh-CN')
  const exactMatch = normalizedNewSpeakerName !== '' && options.some(
    option => option.label.trim().toLocaleLowerCase('zh-CN') === normalizedNewSpeakerName,
  )

  useEffect(() => {
    selectionTouched.current = false
    setPickedPerson(undefined); setPickerOpen(false); setSelected(''); setQuery(''); setBatch(initialBatchUpdate); setMutationError(''); setRemoving(false)
    return () => { viewGeneration.current += 1 }
  }, [initialBatchUpdate, key])

  useEffect(() => {
    if (!selectionTouched.current) setSelected(options.find(option => option.currentAssignment)?.optionKey ?? '')
  }, [options, key, initialBatchUpdate])

  useLayoutEffect(() => {
    const list = listRef.current
    if (!list || !selected || query.trim() || loading) return
    const row = [...list.querySelectorAll<HTMLElement>('[data-speaker-option-key]')]
      .find(node => node.dataset.speakerOptionKey === selected)
    if (!row) return
    const viewport = list.getBoundingClientRect(), bounds = row.getBoundingClientRect()
    // Scroll only this list after filtering is cleared, keeping the transcript
    // and the confirm action still. Leave already-visible selections in place.
    if (bounds.top < viewport.top + 23 || bounds.bottom > viewport.bottom) {
      list.scrollTop = Math.max(0, Math.min(list.scrollHeight - list.clientHeight,
        list.scrollTop + bounds.top - viewport.top - (list.clientHeight - bounds.height) / 2))
    }
  }, [selected, query, loading])

  useLayoutEffect(() => {
    const popover = popoverRef.current
    if (!popover || typeof window === 'undefined') return
    const keepInViewport = () => {
      const bounds = popover.getBoundingClientRect()
      if (bounds.bottom > window.innerHeight - 8) {
        popover.style.top = `${Math.max(8, window.innerHeight - bounds.height - 8)}px`
      }
    }
    keepInViewport()
    // Child-only updates (nearby review, async status) can grow the popover
    // without rendering this editor again.
    const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(keepInViewport)
    observer?.observe(popover)
    window.addEventListener('resize', keepInViewport)
    return () => { observer?.disconnect(); window.removeEventListener('resize', keepInViewport) }
  })

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !pending && !correctionIntent && !reviewOpen && !pickerOpen) onClose()
      if (event.key === 'Tab' && !event.shiftKey && !event.defaultPrevented
        && event.target === triggerRef.current && inputRef.current !== null) {
        event.preventDefault()
        inputRef.current.focus({ preventScroll: true })
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => { document.removeEventListener('keydown', handleKeyDown) }
  }, [onClose, pending, correctionIntent, reviewOpen, pickerOpen])

  const mutate = async () => {
    if (key === undefined || !canSubmit) return
    const generation = viewGeneration.current
    const target = options.find(option => option.optionKey === selected)
    setMutationError('')
    try {
      const result = pickedPerson ? await savePerson(batch ? 'speaker' : 'item', pickedPerson.speakerRef) : await save(batch ? 'speaker' : 'item',
        target === undefined ? { newSpeakerName } : { optionKey: target.optionKey },
      )
      if (result === undefined) return
      if (viewGeneration.current !== generation) return
      onUpdated(result.day); onClose()
    } catch (reason) {
      if (viewGeneration.current !== generation) return
      setMutationError(reason instanceof Error ? reason.message : '说话人修改失败')
    }
  }

  const choose = (option: ArkmeRecordingSpeakerOption) => {
    setPickedPerson(undefined)
    if (pending || removing) return
    selectionTouched.current = true
    setSelected(current => current === option.optionKey ? '' : option.optionKey)
    setQuery('')
  }
  const removeAssignment = async () => {
    if (key === undefined || pending || removing || !item.assignedSpeakerOptionKey) return
    const generation = viewGeneration.current
    setRemoving(true); setMutationError('')
    try {
      const result = await unassign(batch ? 'speaker' : 'item')
      if (result === undefined || viewGeneration.current !== generation) return
      onUpdated(result.day, { itemId: item.itemId, scope: result.scope,
        count: result.scope === 'speaker' ? item.sameSpeakerItemCount : 1,
        ...(result.warning ? { warning: result.warning } : {}) })
      if (result.warning) setMutationError(result.warning)
      else onClose()
    } catch (reason) {
      if (viewGeneration.current === generation) setMutationError(reason instanceof Error ? reason.message : '取消标记失败')
    } finally {
      if (viewGeneration.current === generation) setRemoving(false)
    }
  }
  const canBatch = initialBatchUpdate || item.sameSpeakerItemCount > 1
  const selectedCurrent = options.some(option => option.currentAssignment && option.optionKey === selected)
  const canSubmit = optionsReady && !pending && !removing && !selectedCurrent
    && (!!pickedPerson || options.some(option => option.optionKey === selected) || (newSpeakerName !== '' && !exactMatch))
  const position = recordingSpeakerPopoverPosition(
    anchor ?? { left: 8, right: 40, top: 8, bottom: 40 },
    typeof window === 'undefined' ? { width: 1_024, height: 768 } : { width: window.innerWidth, height: window.innerHeight },
  )

  const layer = <><button type="button" tabIndex={-1} aria-label={tr("关闭说话人编辑")} style={styles.backdrop} onClick={() => { if (!pending && !correctionIntent && !reviewOpen && !pickerOpen) onClose() }} />
  <div ref={popoverRef} style={{ ...styles.popover, left: correctionIntent ? Math.min(position.left, Math.max(8, (typeof window === 'undefined' ? 1024 : window.innerWidth) - 396)) : position.left, top: position.top, ...(correctionIntent ? { width: 'min(388px, calc(100vw - 16px))' } : {}), ...(reviewOpen ? { left: 'auto', right: 8, top: 8, width: 'min(820px, calc(100vw - 16px))', height: 'calc(100vh - 16px)', padding: 16 } : {}) }} role="dialog" aria-label={tr(reviewOpen ? '核对声音' : '编辑说话人')}>
    {reviewOpen ? <ArkmeRecordingSpeakerReview key={item.itemRef} item={item} items={items} options={options} {...(onPlay ? { onPlay } : {})} onUpdated={onUpdated} onClose={onClose} /> : correctionIntent ? <ArkmeRecordingSpeakerCorrection key={item.itemRef} item={item} items={items} intent={correctionIntent}
      autoReject={autoReject} rejectCurrent={correctionChoice.current.rejectCurrent}
      {...(correctionChoice.current.target?.kind === 'speaker' ? { target: correctionChoice.current.target } : {})}
      onUpdated={day => { onUpdated(day) }} onClose={onClose} {...(onPlay ? { onPlay } : {})} /> : <>
    {item.assignedSpeakerOptionKey && <div style={styles.current}>
      <span style={{ color: desktop.secondary }}>{tr("当前标记")}</span>
      {item.speakerAvatarRef && <ArkmeUserAvatar avatarRef={item.speakerAvatarRef} size={20} label={tr("{v0}的头像", { v0: item.speakerLabel })} />}
      <span style={styles.optionLabel} title={item.speakerLabel}>{item.speakerLabel}</span>
      <button type="button" data-arkme-feedback="neutral" aria-label={tr("取消说话人标记")}
        disabled={pending || removing || key === undefined}
        style={{ ...styles.unassign, flexShrink: 0, fontSize: 12, ...(pending || removing ? { opacity: .5, cursor: 'default' } : {}) }}
        onClick={() => { void removeAssignment() }}>
        {removing ? tr("取消中…") : batch ? tr("取消 {v0} 处标记", { v0: item.sameSpeakerItemCount }) : tr("取消标记")}
      </button>
    </div>}
    <div style={{ display: 'flex', flexShrink: 0, flexWrap: 'wrap', gap: 8, padding: '2px 4px 9px', fontSize: 12 }}>
      {onPlay && <button type="button" data-arkme-feedback="neutral" style={{ ...styles.unassign, display: 'inline-flex', alignItems: 'center', gap: 3, color: desktop.blue, fontSize: 12 }} onClick={() => { onPlay(item) }}><Play size={13} />{tr('试听这段')}</button>}
      {correctionPersonLabel && <button type="button" style={{ ...styles.unassign, fontSize: 12 }} disabled={pending}
        onClick={() => { openCorrection('reject') }}>{tr('不是 {v0}', { v0: correctionPersonLabel })}</button>}
      <button type="button" style={{ ...styles.unassign, fontSize: 12, color: desktop.secondary }} disabled={pending} onClick={() => { openCorrection('source') }}>{tr('声音来源 / 纠错')}</button>
      <button type="button" aria-label={tr('查看声音一致性')} style={{ ...styles.unassign, fontSize: 12, color: desktop.blue }} disabled={pending || removing} onClick={() => setReviewOpen(true)}>{tr('声音一致性')} · {tr(recordingConsistencyLabel(consistency.groups[0], consistency.error))}</button>
    </div>
    <input ref={inputRef} style={styles.field} aria-label={tr("说话人名称")} disabled={pending || removing} value={query} maxLength={50} onChange={event => { selectionTouched.current = true; setQuery(event.target.value); setSelected(''); setPickedPerson(undefined) }} placeholder={tr("输入名称")} />
    <button type="button" style={{ ...styles.unassign, color: desktop.blue, padding: '7px 4px', textAlign: 'left', fontSize: 12 }} disabled={pending || removing || !accountScope} onClick={() => setPickerOpen(true)}>{tr('从人物档案选择')} ↗</button>
    {pickedPerson && <div style={styles.current}><span style={styles.optionLabel}>{tr('已选择')}：{pickedPerson.label}</span><button type="button" style={styles.unassign} onClick={() => setPickedPerson(undefined)}>{tr('取消选择')}</button></div>}
    {loading ? <div role="status" style={{ padding: 12, color: desktop.secondary, fontSize: 12 }}>{tr("正在读取候选…")}</div> : <div ref={listRef} style={{ ...styles.list, ...(item.assignedSpeakerOptionKey ? { maxHeight: 248 } : {}) }} data-speaker-options-list>
      <SpeakerSection title={tr("推荐说话人")} options={categories.recommended} selected={selected} disabled={pending || removing} onSelect={choose} />
      <SpeakerSection title={tr("已添加说话人")} options={categories.speakers} selected={selected} disabled={pending || removing} onSelect={choose} />
      <SpeakerSection title={tr("Arkme 用户")} options={categories.users} selected={selected} disabled={pending || removing} onSelect={choose} />
    </div>}
    {newSpeakerName !== '' && !exactMatch && <button data-arkme-feedback="neutral" type="button" aria-label={tr("添加新说话人")} style={styles.add} disabled={!optionsReady || pending} onClick={() => { void mutate() }}><Plus size={15} />{tr("添加“")}{newSpeakerName}{tr("”为说话人")}</button>}
    {optionsError !== '' && <div role="alert" style={styles.error}>{optionsError} <button data-arkme-feedback="neutral" type="button" aria-label={tr("重试读取说话人候选")} style={styles.unassign} onClick={refresh}>{tr("重试")}</button></div>}
    {mutationError !== '' && <div role="alert" style={styles.error}>{mutationError}</div>}
    {canBatch && <div role="group" aria-label={tr('应用范围')} style={styles.scope}>
      {[false, true].map(value => <button key={String(value)} type="button" data-arkme-feedback="neutral" aria-pressed={batch === value}
        disabled={pending || removing} style={{ ...styles.scopeOption, ...(batch === value ? { background: desktop.base, color: desktop.text } : {}), ...(pending || removing ? { opacity: .5, cursor: 'default' } : {}) }}
        onClick={() => { if (!pending && !removing) setBatch(value) }}>{value ? tr('当天同组 {v0} 处', { v0: item.sameSpeakerItemCount }) : tr('仅此片段')}</button>)}
    </div>}
    <div style={styles.bottom}>
      <span style={styles.scopeHint}>{batch ? tr('系统分组，可能包含不同的人') : tr('仅修改当前片段')}</span>
      <button data-arkme-feedback="primary" type="button" style={{ ...styles.confirm, ...(!canSubmit ? { background: desktop.avatar, color: desktop.tertiary, cursor: 'default' } : {}) }} disabled={!canSubmit} onClick={() => { void mutate() }}>{pending ? tr("保存中…") : tr("保存标记")}</button>
    </div>
    </>}
  </div>{pickerOpen && accountScope && <PersonPicker accountScope={accountScope} onClose={() => setPickerOpen(false)} onChoose={value => { selectionTouched.current = true; setPickedPerson(value); setSelected(''); setPickerOpen(false) }}/>}</>
  return typeof document === 'undefined' || document.body === undefined ? layer : createPortal(layer, document.body)
}
