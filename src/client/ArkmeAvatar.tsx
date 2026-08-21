import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import type {
  ArkmeGroupAvatarFallback,
  ArkmeGroupAvatarPresentation,
  ArkmeGroupAvatarSlot,
  ArkmeImagePayload,
} from '../types.js'
import { callArkme } from './api.js'
import { arkmeTheme } from './arkme-theme.js'

const AVATAR_CACHE_TTL_MS = 10 * 60 * 1000
const AVATAR_CACHE_JITTER_MS = 2 * 60 * 1000
const AVATAR_DOWNLOAD_CONCURRENCY = 6

interface AvatarCacheEntry {
  expiresAtMillis: number
  pending: Promise<string>
}

const avatarDataUrlCache = new Map<string, AvatarCacheEntry>()
const avatarDownloadQueue: Array<() => void> = []
let activeAvatarDownloads = 0

function drainAvatarDownloadQueue(): void {
  while (activeAvatarDownloads < AVATAR_DOWNLOAD_CONCURRENCY) {
    const start = avatarDownloadQueue.shift()
    if (start === undefined) return
    activeAvatarDownloads += 1
    start()
  }
}

function scheduleAvatarDownload<T>(load: () => Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    avatarDownloadQueue.push(() => {
      void load().then(resolve, reject).finally(() => {
        activeAvatarDownloads -= 1
        drainAvatarDownloadQueue()
      })
    })
    drainAvatarDownloadQueue()
  })
}

export function clearArkmeAvatarCache(): void {
  avatarDataUrlCache.clear()
}

export function loadArkmeImageDataUrl(imageRef: string): Promise<string> {
  const cached = avatarDataUrlCache.get(imageRef)
  if (cached !== undefined && cached.expiresAtMillis > Date.now()) return cached.pending
  if (cached !== undefined) avatarDataUrlCache.delete(imageRef)
  const entry: AvatarCacheEntry = {
    expiresAtMillis: Date.now() + AVATAR_CACHE_TTL_MS + Math.floor(Math.random() * AVATAR_CACHE_JITTER_MS),
    pending: Promise.resolve(''),
  }
  entry.pending = scheduleAvatarDownload(async () => await callArkme<ArkmeImagePayload>('image.read', { imageRef }))
    .then(image => `data:${image.mediaType};base64,${image.dataBase64}`)
    .catch(error => {
      if (avatarDataUrlCache.get(imageRef) === entry) avatarDataUrlCache.delete(imageRef)
      throw error
    })
  avatarDataUrlCache.set(imageRef, entry)
  return entry.pending
}

interface ResolvedGroupAvatarSlot extends ArkmeGroupAvatarSlot {
  imageUrl?: string
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

function DefaultUserAvatar({ size }: { size: number }) {
  return <span style={{
    width: '100%', height: '100%', display: 'grid', placeItems: 'center', borderRadius: '50%',
    background: arkmeTheme.subtle, color: arkmeTheme.caption,
  }}>
    <svg width={size * .68} height={size * .68} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <circle cx="12" cy="8" r="4" />
      <path d="M4.5 20c.7-4.1 3.2-6.2 7.5-6.2s6.8 2.1 7.5 6.2H4.5Z" />
    </svg>
  </span>
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
  const [imageUrl, setImageUrl] = useState<string>()

  useEffect(() => {
    let active = true
    setImageUrl(undefined)
    if (normalizedRef === '') return () => { active = false }
    void loadArkmeImageDataUrl(normalizedRef)
      .then(value => { if (active) setImageUrl(value) })
      .catch(() => undefined)
    return () => { active = false }
  }, [normalizedRef])

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

/** Compatibility renderer for callers that already resolved legacy avatarRefs. */
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

export function ArkmeSourceAvatar({
  avatarRef,
  avatarRefs,
  groupAvatar,
  size = 44,
}: {
  avatarRef?: string
  avatarRefs?: readonly string[]
  groupAvatar?: ArkmeGroupAvatarPresentation
  size?: number
}) {
  const container = useRef<HTMLSpanElement>(null)
  const isGroup = groupAvatar !== undefined || avatarRefs !== undefined
  const sourceSlots = useMemo<ArkmeGroupAvatarSlot[]>(() => {
    if (groupAvatar !== undefined) return groupAvatar.slots.slice(0, 5)
    return (avatarRefs ?? (avatarRef === undefined ? [] : [avatarRef])).slice(0, 5).map(ref => ({ avatarRef: ref }))
  }, [avatarRef, avatarRefs, groupAvatar])
  const slotsKey = JSON.stringify([sourceSlots, groupAvatar?.computedAtMillis ?? 0])
  const [visible, setVisible] = useState(typeof IntersectionObserver === 'undefined')
  const [slots, setSlots] = useState<ResolvedGroupAvatarSlot[]>(sourceSlots)

  useEffect(() => {
    const target = container.current
    if (target === null || visible) return
    const observer = new IntersectionObserver(entries => {
      if (entries[0]?.isIntersecting !== true) return
      setVisible(true)
      observer.disconnect()
    }, { rootMargin: '160px 0px' })
    observer.observe(target)
    return () => { observer.disconnect() }
  }, [visible])

  useEffect(() => {
    let active = true
    setSlots(sourceSlots)
    if (!visible || sourceSlots.length === 0) return () => { active = false }
    sourceSlots.forEach((slot, index) => {
      if (slot.avatarRef === undefined) return
      void loadArkmeImageDataUrl(slot.avatarRef).then(imageUrl => {
        if (!active) return
        setSlots(current => current.map((value, slotIndex) => slotIndex === index ? { ...slot, imageUrl } : value))
      }).catch(() => {
        if (!active) return
        setSlots(current => current.map((value, slotIndex) => slotIndex === index
          ? { fallback: slot.fallback ?? { kind: 'default' as const } }
          : value))
      })
    })
    return () => { active = false }
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
