import { forwardRef, type ButtonHTMLAttributes, type CSSProperties } from 'react'
import { arkmeTheme } from './arkme-theme.js'

export const ARKME_COMPOSER_TOOL_ICON_SIZE = 20

export const arkmeComposerToolButtonStyle: CSSProperties = Object.freeze({
  width: 34,
  height: 34,
  flex: 'none',
  display: 'grid',
  placeItems: 'center',
  padding: 0,
  border: 0,
  borderRadius: 9,
  background: 'transparent',
  color: arkmeTheme.secondary,
  cursor: 'pointer',
  transition: 'none',
})

/** Shared visual contract for composer toolbar icons; interaction state never changes its styling. */
export const ArkmeComposerToolButton = forwardRef<
  HTMLButtonElement,
  Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'style'>
>(
  function ArkmeComposerToolButton({ type = 'button', ...props }, ref) {
    return <button {...props} ref={ref} type={type} style={arkmeComposerToolButtonStyle} />
  },
)
