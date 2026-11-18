import { Sparkle } from '@phosphor-icons/react/dist/icons/Sparkle'
import { CaretRight } from '@phosphor-icons/react/dist/icons/CaretRight'
import { arkmeTheme } from './arkme-theme.js'
import { tr } from './locale.js'

/** Shared quiet action for message thoughts and reply suggestions. */
export function ArkoThoughtEntryButton({ onOpen, ariaLabel, label = 'Arko有想法', privateOnly = false, record = false, suggestion = false }: {
  onOpen(): void; ariaLabel: string; label?: string; privateOnly?: boolean; record?: boolean; suggestion?: boolean
}) {
  return <button type="button" data-arkme-thought-entry-button
    data-arkme-record-thought-entry={record || undefined} data-arkme-chat-suggestion-entry={suggestion || undefined}
    aria-label={`${tr(ariaLabel)}${privateOnly ? ` · ${tr('仅你可见')}` : ''}`}
    onClick={event => { event.stopPropagation(); onOpen() }}
    style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 4, alignSelf: 'flex-start', minWidth: 0,
      maxWidth: '100%', border: 0, background: 'transparent', padding: '5px 0', color: arkmeTheme.tertiary,
      font: 'inherit', fontSize: 12, textAlign: 'left', cursor: 'pointer' }}>
    <Sparkle size={14} aria-hidden style={{ flexShrink: 0 }}/><span>{tr(label)}</span>
    {privateOnly && <span>· {tr('仅你可见')}</span>}<CaretRight size={12} aria-hidden style={{ flexShrink: 0 }}/>
  </button>
}
