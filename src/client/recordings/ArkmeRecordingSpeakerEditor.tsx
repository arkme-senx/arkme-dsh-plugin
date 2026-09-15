import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import { Check } from '@phosphor-icons/react/dist/icons/Check'
import { Plus } from '@phosphor-icons/react/dist/icons/Plus'
import type { ArkmeRecordingDay, ArkmeRecordingSpeakerOption, ArkmeRecordingWorkbenchItem } from '../../types.js'
import { ArkmeUserAvatar } from '../ArkmeAvatar.js'
import { useRecordingSpeakerOptions } from './use-recording-speaker-options.js'
import { arkmeTheme } from '../arkme-theme.js'

const desktop = {
  base: arkmeTheme.base, hover: arkmeTheme.hover, border: arkmeTheme.border, text: arkmeTheme.text,
  secondary: arkmeTheme.secondary, tertiary: arkmeTheme.tertiary, blue: arkmeTheme.info,
  danger: arkmeTheme.danger, avatar: arkmeTheme.layer2,
}

const styles: Record<string, CSSProperties> = {
  backdrop: { position: 'fixed', zIndex: 1_019, inset: 0, padding: 0, border: 0, background: 'transparent', cursor: 'default' },
  popover: { position: 'fixed', zIndex: 1_020, width: 278, padding: 8, boxSizing: 'border-box', border: `1px solid ${desktop.border}`, borderRadius: 8, background: desktop.base, boxShadow: '0 4px 16px rgba(0,0,0,.1)', color: desktop.text },
  field: { width: '100%', height: 30, boxSizing: 'border-box', padding: '6px 10px', border: `1px solid ${desktop.tertiary}`, borderRadius: 4, background: desktop.base, color: desktop.text, outline: 0, font: 'inherit', fontSize: 12, lineHeight: '16px' },
  list: { maxHeight: 288, marginTop: 6, overflowY: 'auto' },
  title: { height: 23, padding: '4px 8px', boxSizing: 'border-box', display: 'flex', alignItems: 'center', justifyContent: 'space-between', position: 'sticky', top: 0, zIndex: 1, background: desktop.base, color: desktop.tertiary, fontSize: 10, lineHeight: '15px' },
  option: { width: '100%', minHeight: 32, marginBottom: 4, padding: '4px 8px', display: 'flex', alignItems: 'center', gap: 8, border: 0, borderRadius: 4, background: 'transparent', color: desktop.text, cursor: 'pointer', textAlign: 'left', font: 'inherit', fontSize: 14, lineHeight: '16px' },
  avatar: { width: 24, height: 24, flex: 'none', display: 'grid', placeItems: 'center', borderRadius: '50%', background: desktop.avatar, color: desktop.secondary, fontSize: 12, fontWeight: 600 },
  optionLabel: { minWidth: 0, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  add: { width: '100%', minHeight: 28, padding: '2px 8px', display: 'flex', alignItems: 'center', gap: 8, border: 0, borderRadius: 4, background: 'transparent', color: desktop.blue, cursor: 'pointer', textAlign: 'left', fontSize: 12 },
  bottom: { minHeight: 42, marginTop: 2, paddingTop: 6, display: 'flex', alignItems: 'center', gap: 5, borderTop: `1px solid ${desktop.border}` },
  batchText: { minWidth: 0, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: desktop.text, fontSize: 12 },
  confirm: { padding: '6px 14px', border: 0, borderRadius: 10, background: desktop.text, color: desktop.base, cursor: 'pointer', font: 'inherit', fontSize: 14, lineHeight: '16px' },
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

function SpeakerOptionRow({ option, selected, onClick }: {
  option: ArkmeRecordingSpeakerOption
  selected: boolean
  onClick(): void
}) {
  return <button type="button" style={{ ...styles.option, ...(selected ? { background: desktop.hover } : {}) }} onClick={onClick}>
    {option.avatarRef === undefined
      ? <span style={{ ...styles.avatar, ...(selected ? { boxShadow: '0 0 0 1px rgba(9,184,62,.3)' } : {}) }}>{option.label.slice(0, 1) || '声'}</span>
      : <ArkmeUserAvatar avatarRef={option.avatarRef} size={24} label={`${option.label}的头像`} />}
    <span style={styles.optionLabel}>{option.label}{option.isCurrentUser ? '（我）' : ''}</span>
    {selected && <Check size={14} aria-label="已选择" />}
  </button>
}

function SpeakerSection({ title, options, selected, onSelect }: {
  title: string
  options: readonly ArkmeRecordingSpeakerOption[]
  selected: string
  onSelect(option: ArkmeRecordingSpeakerOption): void
}) {
  if (options.length === 0) return null
  return <section><div style={styles.title}><span>{title}</span><span>{options.length}</span></div>{options.map(option => <SpeakerOptionRow key={option.optionKey} option={option} selected={selected === option.optionKey} onClick={() => { onSelect(option) }} />)}</section>
}

export function ArkmeRecordingSpeakerEditor({ item, anchor, forceBatchUpdate = false, onUpdated, onClose }: {
  item: ArkmeRecordingWorkbenchItem
  anchor?: RecordingSpeakerPopoverAnchor
  forceBatchUpdate?: boolean
  onUpdated(day: ArkmeRecordingDay): void
  onClose(): void
}) {
  const { contextKey: key, options, loading, error: optionsError, ready: optionsReady, pending, refresh, save } = useRecordingSpeakerOptions(item)
  const inputRef = useRef<HTMLInputElement>(null)
  const triggerRef = useRef(typeof document === 'undefined' ? null : document.activeElement)
  const selectionTouched = useRef(false)
  const viewGeneration = useRef(0)
  const [selected, setSelected] = useState('')
  const [query, setQuery] = useState('')
  const [batch, setBatch] = useState(forceBatchUpdate)
  const [mutationError, setMutationError] = useState('')
  const categories = useMemo(() => categorizeRecordingSpeakerOptions(options, query), [options, query])
  const newSpeakerName = query.trim()
  const normalizedNewSpeakerName = newSpeakerName.toLocaleLowerCase('zh-CN')
  const exactMatch = normalizedNewSpeakerName !== '' && options.some(
    option => option.label.trim().toLocaleLowerCase('zh-CN') === normalizedNewSpeakerName,
  )

  useEffect(() => {
    selectionTouched.current = false
    setSelected(''); setQuery(''); setBatch(forceBatchUpdate); setMutationError('')
    return () => { viewGeneration.current += 1 }
  }, [forceBatchUpdate, key])

  useEffect(() => {
    if (!selectionTouched.current) setSelected(options.find(option => option.currentAssignment)?.optionKey ?? '')
  }, [options, key, forceBatchUpdate])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !pending) onClose()
      if (event.key === 'Tab' && !event.shiftKey && !event.defaultPrevented
        && event.target === triggerRef.current && inputRef.current !== null) {
        event.preventDefault()
        inputRef.current.focus({ preventScroll: true })
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => { document.removeEventListener('keydown', handleKeyDown) }
  }, [onClose, pending])

  const mutate = async () => {
    if (key === undefined || !canSubmit) return
    const generation = viewGeneration.current
    const target = options.find(option => option.optionKey === selected)
    setMutationError('')
    try {
      const result = await save(forceBatchUpdate || batch ? 'speaker' : 'item',
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
    selectionTouched.current = true
    setSelected(current => current === option.optionKey ? '' : option.optionKey)
    setQuery('')
  }
  const canBatch = forceBatchUpdate || item.sameSpeakerItemCount > 1
  const selectedCurrent = options.some(option => option.currentAssignment && option.optionKey === selected)
  const canSubmit = optionsReady && !pending && !selectedCurrent
    && (options.some(option => option.optionKey === selected) || (newSpeakerName !== '' && !exactMatch))
  const position = recordingSpeakerPopoverPosition(
    anchor ?? { left: 8, right: 40, top: 8, bottom: 40 },
    typeof window === 'undefined' ? { width: 1_024, height: 768 } : { width: window.innerWidth, height: window.innerHeight },
  )

  const layer = <><button type="button" tabIndex={-1} aria-label="关闭说话人编辑" style={styles.backdrop} onClick={() => { if (!pending) onClose() }} />
  <div style={{ ...styles.popover, left: position.left, top: position.top }} role="dialog" aria-label="编辑说话人">
    <input ref={inputRef} style={styles.field} aria-label="说话人名称" value={query} maxLength={50} onChange={event => { selectionTouched.current = true; setQuery(event.target.value); setSelected('') }} placeholder="输入名称" />
    {loading ? <div role="status" style={{ padding: 12, color: desktop.secondary, fontSize: 12 }}>正在读取候选…</div> : <div style={styles.list}>
      <SpeakerSection title="推荐说话人" options={categories.recommended} selected={selected} onSelect={choose} />
      <SpeakerSection title="已添加说话人" options={categories.speakers} selected={selected} onSelect={choose} />
      <SpeakerSection title="Arkme 用户" options={categories.users} selected={selected} onSelect={choose} />
    </div>}
    {newSpeakerName !== '' && !exactMatch && <button type="button" aria-label="添加新说话人" style={styles.add} disabled={!optionsReady || pending} onClick={() => { void mutate() }}><Plus size={15} />添加“{newSpeakerName}”为说话人</button>}
    {optionsError !== '' && <div role="alert" style={styles.error}>{optionsError} <button type="button" aria-label="重试读取说话人候选" style={styles.unassign} onClick={refresh}>重试</button></div>}
    {mutationError !== '' && <div role="alert" style={styles.error}>{mutationError}</div>}
    <div style={styles.bottom}>
      {canBatch ? <><input aria-label="批量修改" type="checkbox" checked={forceBatchUpdate || batch} disabled={pending || forceBatchUpdate} onChange={event => { if (!forceBatchUpdate) setBatch(event.target.checked) }} /><span style={styles.batchText}>批量修改 {item.sameSpeakerItemCount} 处“{item.speakerLabel}”</span></> : <span style={styles.batchText}>仅修改当前片段</span>}
      <button type="button" style={{ ...styles.confirm, ...(!canSubmit ? { background: desktop.avatar, cursor: 'default' } : {}) }} disabled={!canSubmit} onClick={() => { void mutate() }}>{pending ? '保存中…' : '确认'}</button>
    </div>
  </div></>
  return typeof document === 'undefined' || document.body === undefined ? layer : createPortal(layer, document.body)
}
