import { Square } from '@phosphor-icons/react/dist/icons/Square'
import { CheckSquare } from '@phosphor-icons/react/dist/icons/CheckSquare'
import type { ArkmeArrangementStatus } from '../types.js'
import { tr } from './locale.js'

export type ArrangementCompletionPhase = 'completing' | 'restoring'
export function arrangementCompletionChecked(status: ArkmeArrangementStatus, phase?: ArrangementCompletionPhase) {
  return phase === 'restoring' ? false : status === 'completed' || phase === 'completing'
}

/** One control, including its hit target and pending appearance, for every arrangement list. */
export function ArkmeArrangementCompletionControl({ title, status, phase, busy = false, disabled = false, onToggle }: {
  title: string; status: ArkmeArrangementStatus; phase?: ArrangementCompletionPhase | undefined
  busy?: boolean; disabled?: boolean; onToggle(): void
}) {
  const checked = arrangementCompletionChecked(status, phase)
  return <button type="button" role="checkbox" aria-checked={checked}
    aria-label={tr(status === 'completed' ? '取消完成：{title}' : '完成：{title}', { title })}
    className="arkme-arrangement-checkbox arkme-arrangement-completion-control" disabled={disabled || busy || !!phase || status === 'unknown'}
    aria-busy={busy || !!phase} onClick={onToggle}>
    {checked ? <CheckSquare size={20} weight="fill" className="arkme-arrangement-checkbox-icon" aria-hidden />
      : <Square size={20} className="arkme-arrangement-checkbox-icon" aria-hidden />}
  </button>
}
