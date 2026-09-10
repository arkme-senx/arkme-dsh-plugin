import { X } from '@phosphor-icons/react/dist/icons/X'
import { arkmeTheme as colors } from '../arkme-theme.js'
import { RecordingDesktopIcon } from './RecordingDesktopIcon.js'
import { RecordingTranscriptButton } from './RecordingTranscriptButton.js'

export function RecordingTranscriptSearch({ query, position, count, onChange, onFind, onPrevious, onNext }: {
  query: string; position: number; count: number
  onChange(query: string): void; onFind(): void; onPrevious(): void; onNext(): void
}) {
  return <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
    <style>{`
      .arkme-recording-transcript-search-field { border: 1px solid ${colors.border}; }
      .arkme-recording-transcript-search-field:focus-within { border-color: ${colors.accent}; }
    `}</style>
    <div className="arkme-recording-transcript-search-field" style={{ display: 'flex', alignItems: 'center', width: 224, minWidth: 120, height: 30, boxSizing: 'border-box', borderRadius: 8, background: colors.layer2 }}>
      <RecordingTranscriptButton aria-label="查找转写" onClick={onFind} style={{ border: 0, background: 'transparent', padding: 0, width: 32, flex: 'none', display: 'grid', placeItems: 'center', color: colors.secondary }}><RecordingDesktopIcon name="search" size={14} /></RecordingTranscriptButton>
      <input aria-label="搜索当天转写" placeholder="搜索当天转写" maxLength={64} value={query} onChange={event => { onChange(event.target.value) }} onKeyDown={event => {
        if (event.key === 'Enter' && !event.nativeEvent?.isComposing) { event.preventDefault(); onFind() }
        if (event.key === 'Escape') onChange('')
      }} style={{ minWidth: 0, flex: 1, padding: 0, border: 0, outline: 0, background: 'transparent', color: colors.text, font: 'inherit', fontSize: 13 }} />
      <span role="status" aria-label="搜索命中数" style={{ whiteSpace: 'nowrap', color: colors.secondary, fontSize: 12, paddingRight: query === '' ? 10 : 0 }}>{`${position}/${count}`}</span>
      {query !== '' && <RecordingTranscriptButton aria-label="清除转写搜索" onClick={() => { onChange('') }} style={{ border: 0, background: 'transparent', padding: 0, width: 26, flex: 'none', display: 'grid', placeItems: 'center', color: colors.secondary }}><X size={14} /></RecordingTranscriptButton>}
    </div>
    {query.trim() !== '' && <span style={{ display: 'flex', gap: 6 }}>
      <RecordingTranscriptButton aria-label="上一个匹配" disabled={count === 0} onClick={onPrevious} style={{ minWidth: 62, height: 28, borderRadius: 6 }}>上一个</RecordingTranscriptButton>
      <RecordingTranscriptButton aria-label="下一个匹配" disabled={count === 0} onClick={onNext} style={{ minWidth: 62, height: 28, borderRadius: 6 }}>下一个</RecordingTranscriptButton>
    </span>}
  </div>
}
