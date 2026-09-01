import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import type {
  ArkmeGroupAvatarFallback,
  ArkmeGroupAvatarPresentation,
  ArkmeGroupAvatarSlot,
  ArkmeSourceItem,
} from '../types.js'
import { arkmeTheme } from './arkme-theme.js'
import { arkmeAvatarImages } from './avatar-image-runtime.js'
import { useArkmeAvatarImage } from './use-arkme-avatar-image.js'

interface ResolvedGroupAvatarSlot extends ArkmeGroupAvatarSlot {
  imageUrl?: string
}

function applyCachedAvatarSlots(sourceSlots: readonly ArkmeGroupAvatarSlot[]): ResolvedGroupAvatarSlot[] {
  return sourceSlots.map(slot => {
    if (slot.avatarRef === undefined) return slot
    const imageUrl = arkmeAvatarImages.current(slot.avatarRef)
    return imageUrl === undefined ? slot : { ...slot, imageUrl }
  })
}

function reconcileAvatarSlots(
  current: readonly ResolvedGroupAvatarSlot[],
  sourceSlots: readonly ArkmeGroupAvatarSlot[],
): ResolvedGroupAvatarSlot[] {
  return sourceSlots.map((slot, index) => {
    if (slot.avatarRef === undefined) return slot
    const currentSlot = current[index]
    const imageUrl = currentSlot?.avatarRef === slot.avatarRef
      ? currentSlot.imageUrl
      : arkmeAvatarImages.current(slot.avatarRef)
    return imageUrl === undefined ? slot : { ...slot, imageUrl }
  })
}

interface AvatarLayoutSlot {
  left: number
  top: number
  sizeFactor: number
}

const PHONE_DEFAULT_COLORS = [
  '#2BB673', '#2F80ED', '#F2994A', '#EB5757', '#9B51E0', '#00A6A6',
  '#6FCF97', '#56CCF2', '#F2C94C', '#BB6BD9', '#4F4F4F', '#27AE60',
] as const

const GROUP_AVATAR_LAYOUTS: Readonly<Record<number, readonly AvatarLayoutSlot[]>> = {
  1: [{ left: .04, top: .04, sizeFactor: .92 }],
  2: [{ left: -.10, top: -.08, sizeFactor: .84 }, { left: .44, top: .46, sizeFactor: .58 }],
  3: [{ left: -.10, top: -.08, sizeFactor: .82 }, { left: .56, top: .12, sizeFactor: .44 }, { left: .28, top: .56, sizeFactor: .44 }],
  4: [{ left: -.10, top: -.08, sizeFactor: .80 }, { left: .56, top: .05, sizeFactor: .39 }, { left: .58, top: .44, sizeFactor: .39 }, { left: .15, top: .62, sizeFactor: .39 }],
  5: [{ left: -.10, top: -.08, sizeFactor: .80 }, { left: .56, top: .05, sizeFactor: .35 }, { left: .68, top: .36, sizeFactor: .35 }, { left: .48, top: .65, sizeFactor: .35 }, { left: .15, top: .64, sizeFactor: .35 }],
}

function avatarStyles(size: number): Record<string, CSSProperties> {
  return {
    avatar: {
      width: size, height: size, flex: 'none', position: 'relative', overflow: 'hidden', borderRadius: 999,
      display: 'grid', placeItems: 'center', background: 'transparent', color: arkmeTheme.secondary, fontSize: 15, fontWeight: 600,
    },
    image: { width: '100%', height: '100%', display: 'block', objectFit: 'cover' },
  }
}

export function ArkmeDefaultAvatarFrame({ children }: { children: ReactNode }) {
  return <span style={{
    width: '100%', height: '100%', display: 'grid', placeItems: 'center', borderRadius: '50%',
    background: arkmeTheme.subtle, color: arkmeTheme.caption,
  }}>{children}</span>
}

function DefaultUserAvatar({ size }: { size: number }) {
  return <ArkmeDefaultAvatarFrame>
    <svg width={size * .68} height={size * .68} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <circle cx="12" cy="8" r="4" />
      <path d="M4.5 20c.7-4.1 3.2-6.2 7.5-6.2s6.8 2.1 7.5 6.2H4.5Z" />
    </svg>
  </ArkmeDefaultAvatarFrame>
}

function PhoneDefaultAvatar({ fallback, size }: { fallback: Extract<ArkmeGroupAvatarFallback, { kind: 'phone_default' }>; size: number }) {
  const index = Math.abs(Math.trunc(fallback.colorIndex)) % PHONE_DEFAULT_COLORS.length
  return <span style={{
    width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', borderRadius: '50%',
    background: PHONE_DEFAULT_COLORS[index], color: '#fff', fontSize: Math.max(10, size * .36),
    lineHeight: 1, fontWeight: 700, overflow: 'hidden',
  }}>{fallback.label || '--'}</span>
}

export function ArkmeUserAvatar({
  avatarRef,
  fallback,
  size = 44,
  label = '用户头像',
}: {
  avatarRef?: string
  fallback?: ArkmeGroupAvatarFallback
  size?: number
  label?: string
}) {
  const normalizedRef = avatarRef?.trim() ?? ''
  const imageUrl = useArkmeAvatarImage(normalizedRef)

  const styles = avatarStyles(size)
  return <span style={styles.avatar} aria-label={label}>
    {imageUrl !== undefined
      ? <img src={imageUrl} alt="" draggable={false} style={styles.image} />
      : fallback?.kind === 'phone_default'
        ? <PhoneDefaultAvatar fallback={fallback} size={size} />
        : <DefaultUserAvatar size={size} />}
  </span>
}

function GroupAvatarMember({ slot, size }: { slot: ResolvedGroupAvatarSlot; size: number }) {
  if (slot.imageUrl !== undefined) {
    return <img src={slot.imageUrl} alt="" draggable={false} style={{ width: '100%', height: '100%', display: 'block', objectFit: 'cover' }} />
  }
  if (slot.fallback?.kind === 'phone_default') return <PhoneDefaultAvatar fallback={slot.fallback} size={size} />
  return <DefaultUserAvatar size={size} />
}

function GroupAvatarAddSlot({ size }: { size: number }) {
  return <span style={{
    width: '100%', height: '100%', display: 'grid', placeItems: 'center', borderRadius: '50%',
    background: arkmeTheme.elevated, color: arkmeTheme.caption, fontSize: Math.max(7, size * .42),
    lineHeight: 1, fontWeight: 400,
  }}>+</span>
}

export function ArkmeGroupAvatarVisual({
  memberCount,
  slots,
  size = 44,
  fallback = true,
}: {
  memberCount: number
  slots: readonly ResolvedGroupAvatarSlot[]
  size?: number
  fallback?: boolean
}) {
  const actualSlots = slots.slice(0, 5)
  if (!fallback && actualSlots.length === 0) return <span style={{ width: size, height: size, flex: 'none' }} aria-hidden />
  const layoutMemberCount = Math.max(0, Math.trunc(memberCount), actualSlots.length)
  const templateCount = layoutMemberCount <= 1 ? 1 : Math.min(layoutMemberCount, 5)
  const showAddSlot = layoutMemberCount <= 1 && actualSlots.length === 1
  const layoutCount = showAddSlot ? 2 : templateCount
  const layout = GROUP_AVATAR_LAYOUTS[layoutCount] ?? GROUP_AVATAR_LAYOUTS[5]!
  const resolvedSlots = [...actualSlots]
  while (resolvedSlots.length < templateCount) resolvedSlots.push({ fallback: { kind: 'default' } })
  return <span
    aria-hidden
    data-arkme-group-avatar-count={layoutCount}
    style={{
      width: size, height: size, flex: 'none', position: 'relative', display: 'block', overflow: 'hidden',
      borderRadius: '50%', background: arkmeTheme.active,
    }}
  >
    {layout.map((position, index) => {
      const slotSize = size * position.sizeFactor
      return <span
        key={index}
        data-arkme-group-avatar-slot={index}
        style={{
          position: 'absolute', left: size * position.left, top: size * position.top,
          width: slotSize, height: slotSize, boxSizing: 'border-box', overflow: 'hidden', borderRadius: '50%',
          border: `${Math.max(1.2, slotSize * .09)}px solid ${arkmeTheme.base}`,
        }}
      >
        {showAddSlot && index === 1
          ? <GroupAvatarAddSlot size={slotSize} />
          : <GroupAvatarMember slot={resolvedSlots[index] ?? { fallback: { kind: 'default' } }} size={slotSize} />}
      </span>
    })}
  </span>
}

/** Renderer for callers that already own resolved group-member image URLs. */
export function ArkmeAvatarMosaic({
  urls,
  size = 44,
  fallback = true,
}: {
  urls: readonly string[]
  size?: number
  fallback?: boolean
}) {
  const slots = urls.slice(0, 5).map(imageUrl => ({ imageUrl }))
  return <ArkmeGroupAvatarVisual memberCount={slots.length} slots={slots} size={size} fallback={fallback} />
}

type ArkmeSourceAvatarProps =
  | { kind: 'single'; avatarRef?: string | undefined; size?: number | undefined }
  | {
    kind: 'group'
    avatarRefs?: readonly string[] | undefined
    groupAvatar?: ArkmeGroupAvatarPresentation | undefined
    size?: number | undefined
  }

export function ArkmeSourceAvatar(props: ArkmeSourceAvatarProps) {
  const size = props.size ?? 44
  const isGroup = props.kind === 'group'
  const avatarRef = props.kind === 'single' ? props.avatarRef : undefined
  const avatarRefs = props.kind === 'group' ? props.avatarRefs : undefined
  const groupAvatar = props.kind === 'group' ? props.groupAvatar : undefined
  const container = useRef<HTMLSpanElement>(null)
  const sourceSlots = useMemo<ArkmeGroupAvatarSlot[]>(() => {
    if (groupAvatar !== undefined) return groupAvatar.slots.slice(0, 5)
    return (isGroup ? avatarRefs ?? [] : avatarRef === undefined ? [] : [avatarRef])
      .slice(0, 5)
      .map(ref => ({ avatarRef: ref }))
  }, [avatarRef, avatarRefs, groupAvatar, isGroup])
  const slotsKey = JSON.stringify(sourceSlots)
  const [visible, setVisible] = useState(() => typeof globalThis.IntersectionObserver !== 'function')
  const [slots, setSlots] = useState<ResolvedGroupAvatarSlot[]>(() => applyCachedAvatarSlots(sourceSlots))

  useEffect(() => {
    const target = container.current
    if (target === null || visible) return
    const Observer = globalThis.IntersectionObserver
    if (typeof Observer !== 'function') {
      setVisible(true)
      return
    }
    // Some embedded DSH WebViews expose IntersectionObserver but do not deliver the initial entry.
    // Preserve lazy loading where available while guaranteeing that visible avatars cannot stay placeholders forever.
    const fallbackTimer = globalThis.setTimeout(() => { setVisible(true) }, 250)
    const observer = new Observer(entries => {
      if (entries[0]?.isIntersecting !== true) return
      setVisible(true)
      globalThis.clearTimeout(fallbackTimer)
      observer.disconnect()
    }, { rootMargin: '160px 0px' })
    observer.observe(target)
    return () => {
      globalThis.clearTimeout(fallbackTimer)
      observer.disconnect()
    }
  }, [visible])

  useEffect(() => {
    let active = true
    setSlots(current => reconcileAvatarSlots(current, sourceSlots))
    if (!visible || sourceSlots.length === 0) return () => { active = false }
    const imageRefs = [...new Set(sourceSlots.flatMap(slot => slot.avatarRef === undefined ? [] : [slot.avatarRef]))]
    const unsubscribes = imageRefs.map(imageRef => arkmeAvatarImages.subscribe(imageRef, imageUrl => {
      if (!active) return
      setSlots(current => current.map(slot => {
        if (slot.avatarRef !== imageRef) return slot
        if (imageUrl !== undefined) return { ...slot, imageUrl }
        const { imageUrl: _discarded, ...unresolvedSlot } = slot
        return unresolvedSlot
      }))
    }))
    imageRefs.forEach(imageRef => {
      void arkmeAvatarImages.load(imageRef).catch(() => undefined)
    })
    return () => {
      active = false
      unsubscribes.forEach(unsubscribe => { unsubscribe() })
    }
  }, [slotsKey, visible])

  const styles = avatarStyles(size)
  return <span ref={container} aria-hidden style={{ width: size, height: size, flex: 'none', display: 'grid', placeItems: 'center' }}>
    {isGroup
      ? <ArkmeGroupAvatarVisual memberCount={groupAvatar?.memberCount ?? sourceSlots.length} slots={slots} size={size} />
      : slots[0]?.imageUrl !== undefined
        ? <span style={styles.avatar}><img src={slots[0].imageUrl} alt="" draggable={false} style={styles.image} /></span>
        : <span style={styles.avatar}><DefaultUserAvatar size={size} /></span>}
  </span>
}

export function ArkmeDirectorySourceAvatar({
  source,
  size,
}: {
  source: Pick<ArkmeSourceItem, 'kind' | 'avatarRef' | 'avatarRefs' | 'groupAvatar'>
  size?: number | undefined
}) {
  return source.kind === 'group_chat'
    ? <ArkmeSourceAvatar kind="group" avatarRefs={source.avatarRefs} groupAvatar={source.groupAvatar} size={size} />
    : <ArkmeSourceAvatar kind="single" avatarRef={source.avatarRef} size={size} />
}
