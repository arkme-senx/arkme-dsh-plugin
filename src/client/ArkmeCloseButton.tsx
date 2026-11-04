import { forwardRef, type ButtonHTMLAttributes, type CSSProperties } from 'react'
import { X } from '@phosphor-icons/react/X'
import { tr } from './locale.js'

type CloseButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'>

const targetStyle = {
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
  boxSizing: 'border-box', width: 36, height: 36, minWidth: 36, minHeight: 36,
  maxWidth: 'none', maxHeight: 'none', padding: 0, border: 0, borderRadius: 8,
  background: 'transparent', color: 'var(--dsw-alias-label-secondary, #68707c)',
  cursor: 'pointer', lineHeight: 1, WebkitAppRegion: 'no-drag',
} as CSSProperties

/** Shared hit target and glyph; each owner keeps its own guarded close action. */
export const ArkmeCloseButton = forwardRef<HTMLButtonElement, CloseButtonProps>(function ArkmeCloseButton(
  { className, style, onClick, 'aria-label': label = tr('关闭'), ...props }, ref,
) {
  return <button {...props} ref={ref} type="button" aria-label={label}
    data-arkme-feedback="neutral" data-arkme-dialog-close="" className={['arkme-close-button', className].filter(Boolean).join(' ')}
    style={{ ...style, ...targetStyle,
      ...(style?.display === 'none' ? { display: 'none' } : {}),
      ...(style?.color ? { color: style.color } : {}),
    }} onClick={onClick}><X size={20} weight="regular" aria-hidden="true" focusable="false" /></button>
})
