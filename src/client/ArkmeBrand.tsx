import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type { CSSProperties } from 'react'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { useArkmeBrand } from './product-brand.js'
import { ArkmeJiwoBrandMark } from './ArkmeJiwoBrandMark.js'

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
  const brand = useArkmeBrand()
  const width = brand.name === '即我' ? size * 2 : wordmarkWidth(size)
  return <ArkmeJiwoBrandMark style={{ width, height: size, maxWidth: 'none' }} />
}

/** The complete wordmark is already rendered by the adjacent mark slot. */
export function ArkmeSidebarBrandName() {
  return null
}

/** The public new-session contract is a square mark slot beside a host-owned headline. */
export function ArkmeHeroBrandMark({ size, className }: HeroMarkProps) {
  const brand = useArkmeBrand()
  return (
    <img
      src={brand.icon}
      alt={brand.name}
      width={size}
      height={size}
      className={className}
      style={imageStyle}
    />
  )
}
