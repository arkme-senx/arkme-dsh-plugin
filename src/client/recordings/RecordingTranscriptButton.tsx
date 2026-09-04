import { forwardRef, type ButtonHTMLAttributes } from 'react'
import { arkmeTheme } from '../arkme-theme.js'

export const RecordingTranscriptButton = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement>>(function RecordingTranscriptButton({ style, disabled, ...props }, ref) {
  return <button {...props} ref={ref} type="button" disabled={disabled} style={{
    minHeight: 28, padding: '4px 10px', border: `1px solid ${arkmeTheme.border}`, borderRadius: 8,
    background: arkmeTheme.elevated, color: arkmeTheme.text, font: 'inherit', fontSize: 13,
    cursor: disabled ? 'default' : 'pointer', opacity: disabled ? .4 : 1, whiteSpace: 'nowrap', ...style,
  }} />
})
