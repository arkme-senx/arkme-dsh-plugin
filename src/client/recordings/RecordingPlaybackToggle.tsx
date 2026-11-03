import type { CSSProperties } from 'react'
import { Pause } from '@phosphor-icons/react/dist/icons/Pause'
import { Play } from '@phosphor-icons/react/dist/icons/Play'
import { CircleNotch } from '@phosphor-icons/react/dist/icons/CircleNotch'
import { arkmeTheme } from '../arkme-theme.js'
import { tr } from '../locale.js'

/** These controls sit inside selectable messages and draggable time rails. */
export function RecordingPlaybackToggle({ playing, loading = false, disabled = false, label, onToggle, style }: {
  playing: boolean; loading?: boolean; disabled?: boolean; label: string; onToggle(): void; style?: CSSProperties
}) {
  return <button type="button" data-arkme-feedback="preserve" data-recording-playback-control
    aria-label={tr(label)} title={tr(label)} disabled={disabled} aria-busy={loading || undefined}
    style={{ width: 24, height: 24, padding: 0, flex: 'none', display: 'inline-grid', placeItems: 'center',
      border: 0, borderRadius: '50%', background: arkmeTheme.info, color: arkmeTheme.base,
      cursor: disabled ? 'default' : 'pointer', opacity: disabled ? .5 : 1, verticalAlign: 'middle', ...style }}
    onPointerDown={event => { event.stopPropagation(); event.preventDefault() }}
    onPointerUp={event => event.stopPropagation()}
    onDoubleClick={event => { event.stopPropagation(); event.preventDefault() }}
    onKeyDown={event => { if (event.key === ' ' || event.key === 'Enter') event.stopPropagation() }}
    onClick={event => { event?.stopPropagation(); event?.preventDefault(); onToggle() }}>
    {loading ? <CircleNotch size={15} className="arkme-icon-spin" aria-hidden />
      : playing ? <Pause size={13} weight="fill" aria-hidden /> : <Play size={13} weight="fill" aria-hidden />}
  </button>
}
