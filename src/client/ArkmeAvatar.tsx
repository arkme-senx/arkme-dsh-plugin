import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import type { ArkmeImagePayload } from '../types.js'
import { callArkme } from './api.js'
import { ArkmeMark } from './ArkmeFooterAction.js'

const avatarDataUrlCache = new Map<string, Promise<string>>()

export function clearArkmeAvatarCache(): void {
  avatarDataUrlCache.clear()
}

export function loadArkmeImageDataUrl(imageRef: string): Promise<string> {
  const cached = avatarDataUrlCache.get(imageRef)
  if (cached !== undefined) return cached
  const pending = callArkme<ArkmeImagePayload>('image.read', { imageRef })
    .then(image => `data:${image.mediaType};base64,${image.dataBase64}`)
    .catch(error => {
      avatarDataUrlCache.delete(imageRef)
      throw error
    })
  avatarDataUrlCache.set(imageRef, pending)
  return pending
}

function avatarStyles(size: number): Record<string, CSSProperties> {
  return {
    avatar: {
      width: size, height: size, flex: 'none', position: 'relative', overflow: 'hidden', borderRadius: 999,
      display: 'grid', placeItems: 'center', background: 'transparent', color: '#727982', fontSize: 15, fontWeight: 600,
    },
    image: { width: '100%', height: '100%', display: 'block', objectFit: 'cover' },
    grid: { width: '100%', height: '100%', display: 'grid', gap: 1, padding: 2, boxSizing: 'border-box', background: '#eef0f1' },
  }
}

export function ArkmeAvatarMosaic({
  urls,
  size = 44,
  fallback = true,
}: {
  urls: readonly string[]
  size?: number
  fallback?: boolean
}) {
  const styles = avatarStyles(size)
  const visibleUrls = urls.filter(url => url !== '').slice(0, 4)
  const count = visibleUrls.length
  const columns = count <= 1 ? 1 : 2
  const rows = count <= 2 ? 1 : 2
  return <span style={styles.avatar} aria-hidden>
    {count === 0 ? (fallback ? <ArkmeMark size={size} /> : null) : count === 1
      ? <img src={visibleUrls[0]} alt="" draggable={false} style={styles.image} />
      : <span style={{ ...styles.grid, gridTemplateColumns: `repeat(${columns}, 1fr)`, gridTemplateRows: `repeat(${rows}, 1fr)` }}>
        {visibleUrls.map((url, index) => <img key={`${url.slice(-20)}-${String(index)}`} src={url} alt="" draggable={false} style={styles.image} />)}
      </span>}
  </span>
}

export function ArkmeSourceAvatar({
  avatarRef,
  avatarRefs,
  size = 44,
}: {
  avatarRef?: string
  avatarRefs?: readonly string[]
  size?: number
}) {
  const container = useRef<HTMLSpanElement>(null)
  const refs = useMemo(
    () => (avatarRefs ?? (avatarRef === undefined ? [] : [avatarRef])).slice(0, 4),
    [avatarRef, avatarRefs],
  )
  const refsKey = refs.join('|')
  const [visible, setVisible] = useState(typeof IntersectionObserver === 'undefined')
  const [urls, setUrls] = useState<string[]>([])

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
    setUrls([])
    if (!visible || refs.length === 0) return () => { active = false }
    void Promise.all(refs.map(async ref => {
      try { return await loadArkmeImageDataUrl(ref) }
      catch { return '' }
    })).then(values => { if (active) setUrls(values.filter(value => value !== '')) })
    return () => { active = false }
  }, [refsKey, visible])

  return <span
    ref={container}
    aria-hidden
    style={{ width: size, height: size, flex: 'none', display: 'grid', placeItems: 'center' }}
  >
    <ArkmeAvatarMosaic urls={urls} size={size} />
  </span>
}
