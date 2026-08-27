import type { CSSProperties, ReactNode } from 'react'
import { ARKME_COMPOSER_TOOL_ICON_SIZE } from './ArkmeComposerToolButton.js'

const iconStyle: CSSProperties = { display: 'block', flex: 'none' }

function ArkmeComposerToolIcon({ children }: { children: ReactNode }) {
  return <svg
    width={ARKME_COMPOSER_TOOL_ICON_SIZE}
    height={ARKME_COMPOSER_TOOL_ICON_SIZE}
    viewBox="0 0 20 20"
    fill="none"
    aria-hidden
    focusable="false"
    style={iconStyle}
  >{children}</svg>
}

/** Matches the desktop sentiment icon without scaling a 256px glyph into a fractional stroke. */
export function ArkmeComposerEmojiIcon() {
  return <ArkmeComposerToolIcon>
    <circle cx="10" cy="10" r="7.25" stroke="currentColor" strokeWidth="1.5" />
    <circle cx="7.25" cy="8.25" r="0.85" fill="currentColor" />
    <circle cx="12.75" cy="8.25" r="0.85" fill="currentColor" />
    <path d="M6.75 11.5C7.5 12.85 8.68 13.5 10 13.5C11.32 13.5 12.5 12.85 13.25 11.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
  </ArkmeComposerToolIcon>
}
