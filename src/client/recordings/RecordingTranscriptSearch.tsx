import { tr } from '../locale.js'
import { useEffect, useRef, useState } from 'react'
import { Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import { X } from '@phosphor-icons/react/dist/icons/X'
import { arkmeTheme as colors } from '../arkme-theme.js'
import { RecordingDesktopIcon } from './RecordingDesktopIcon.js'
import { RecordingTranscriptButton } from './RecordingTranscriptButton.js'

export function RecordingTranscriptSearch({ query, position, count, onChange, onFind, onPrevious, onNext }: {
  query: string; position: number; count: number
  onChange(query: string): void; onFind(): void; onPrevious(): void; onNext(): void
}) {
  const [expanded, setExpanded] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const showField = expanded || query !== ''
  useEffect(() => { if (expanded) inputRef.current?.focus?.() }, [expanded])
  return <div onBlur={event => {
    if (query.trim() === '' && !event.currentTarget.contains(event.relatedTarget as Node | null)) {
      setExpanded(false)
      if (query !== '') onChange('')
    }
  }} onKeyDown={event => {
    if (event.key === 'Escape' && !event.nativeEvent?.isComposing) {
      event.preventDefault(); event.stopPropagation(); onChange(''); setExpanded(false); buttonRef.current?.focus?.()
    }
  }} style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 8, minWidth: 0, maxWidth: '100%', flex: '0 1 auto' }}>
    <style>{`
      .arkme-recording-transcript-search-field { border: 1px solid ${colors.border}; }
      .arkme-recording-transcript-search-field:focus-within { border-color: ${colors.accent}; }
    `}</style>
    <div className={showField ? 'arkme-recording-transcript-search-field' : undefined} style={{ display: 'flex', alignItems: 'center', width: showField ? 224 : 28, maxWidth: '100%', minWidth: showField ? 120 : 28, flex: showField ? '0 1 224px' : 'none', height: showField ? 30 : 28, boxSizing: 'border-box', borderRadius: 8, background: showField ? colors.layer2 : 'transparent' }}>
      <Tooltip label={tr('搜索')} side="bottom" delayMs={200}>
        <RecordingTranscriptButton ref={buttonRef} aria-label={tr('搜索')} aria-expanded={showField} onClick={() => { if (showField) { onFind(); inputRef.current?.focus?.() } else setExpanded(true) }} style={{ border: 0, background: 'transparent', padding: 0, width: showField ? 32 : 28, flex: 'none', display: 'grid', placeItems: 'center', color: colors.secondary }}><RecordingDesktopIcon name="search" /></RecordingTranscriptButton>
      </Tooltip>
      {showField && <>
      <input ref={inputRef} aria-label={tr("搜索当天转写")} placeholder={tr("搜索当天转写")} maxLength={64} value={query} onChange={event => { onChange(event.target.value) }} onKeyDown={event => {
        if (event.key === 'Enter' && !event.nativeEvent?.isComposing) { event.preventDefault(); onFind() }
      }} style={{ minWidth: 0, flex: 1, padding: 0, border: 0, outline: 0, background: 'transparent', color: colors.text, font: 'inherit', fontSize: 13 }} />
      <span role="status" aria-label={tr("搜索命中数")} style={{ whiteSpace: 'nowrap', color: colors.secondary, fontSize: 12, paddingRight: query === '' ? 10 : 0 }}>{`${position}/${count}`}</span>
      {query !== '' && <RecordingTranscriptButton aria-label={tr("清除转写搜索")} onClick={() => { setExpanded(true); onChange(''); inputRef.current?.focus?.() }} style={{ border: 0, background: 'transparent', padding: 0, width: 26, flex: 'none', display: 'grid', placeItems: 'center', color: colors.secondary }}><X size={14} /></RecordingTranscriptButton>}
      </>}
    </div>
    {query.trim() !== '' && <span style={{ display: 'flex', gap: 6 }}>
      <RecordingTranscriptButton aria-label={tr("上一个匹配")} disabled={count === 0} onClick={onPrevious} style={{ minWidth: 62, height: 28, borderRadius: 6 }}>{tr("上一个")}</RecordingTranscriptButton>
      <RecordingTranscriptButton aria-label={tr("下一个匹配")} disabled={count === 0} onClick={onNext} style={{ minWidth: 62, height: 28, borderRadius: 6 }}>{tr("下一个")}</RecordingTranscriptButton>
    </span>}
  </div>
}
