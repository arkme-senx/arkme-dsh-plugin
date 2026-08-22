import type { CSSProperties } from 'react'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { ARKME_ICON_DATA_URL } from './arkme-assets.js'
import { ARKME_WORDMARK_DATA_URL } from './arkme-wordmark.js'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    'sidebar.brand.mark': {
      kind: 'single'
      scope: 'root'
      owner: { size: number }
    }
    'sidebar.brand.name': {
      kind: 'single'
      scope: 'root'
      owner: Record<string, never>
    }
    'conversation.hero.brand.mark': {
      kind: 'single'
      scope: 'root'
      owner: { size: number; className?: string }
    }
  }
}

type SidebarMarkProps = PropsRuntime<'sidebar.brand.mark'>
type HeroMarkProps = PropsRuntime<'conversation.hero.brand.mark'>

const imageStyle: CSSProperties = {
  display: 'block',
  objectFit: 'contain',
}

const WORDMARK_RATIO = 640 / 159

function wordmarkWidth(height: number): number {
  return Math.round(height * WORDMARK_RATIO)
}

/** Arkme's brand asset is one complete wordmark, so the mark slot supplies it without splitting the A. */
export function ArkmeSidebarBrandMark({ size }: SidebarMarkProps) {
  return <img
    src={ARKME_WORDMARK_DATA_URL}
    alt="Arkme"
    width={wordmarkWidth(size)}
    height={size}
    style={{ ...imageStyle, width: wordmarkWidth(size), height: size, maxWidth: 'none' }}
  />
}

/** The complete wordmark is already rendered by the adjacent mark slot. */
export function ArkmeSidebarBrandName() {
  return null
}

/** The public new-session contract is a square mark slot beside a host-owned headline. */
export function ArkmeHeroBrandMark({ size, className }: HeroMarkProps) {
  return (
    <img
      src={ARKME_ICON_DATA_URL}
      alt="Arkme"
      width={size}
      height={size}
      className={className}
      style={imageStyle}
    />
  )
}
