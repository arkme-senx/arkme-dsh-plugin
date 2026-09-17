import type { ArkmeAvatarImagePort } from './avatar-image-store.js'
import { useCallback, useEffect, useState, useSyncExternalStore, type RefObject } from 'react'
import { arkmeAvatarImages } from './avatar-image-runtime.js'

/** React adapter for one opaque avatar ref; cache and subscription policy stay in the image Port. */
export function useArkmeAvatarImage(imageRef: string | undefined, element?: RefObject<Element>, options?: { store?: ArkmeAvatarImagePort | undefined; cacheKey?: string | undefined }): string | undefined {
  const store = options?.store ?? arkmeAvatarImages
  const [visible, setVisible] = useState(false)
  const deferred = element !== undefined && typeof globalThis.IntersectionObserver === 'function'
  useEffect(() => {
    const target = element?.current
    if (!target || !deferred) return
    const observer = new IntersectionObserver(entries => { setVisible(entries.some(entry => entry.isIntersecting)) })
    observer.observe(target)
    return () => { observer.disconnect() }
  }, [element, deferred])
  const normalizedRef = !deferred || visible ? imageRef?.trim() ?? '' : ''
  const cacheKey = normalizedRef ? options?.cacheKey?.trim() || normalizedRef : ''
  const subscribe = useCallback((listener: () => void) => normalizedRef === ''
    ? () => undefined
    : store.subscribe(cacheKey, () => { listener() }), [normalizedRef, cacheKey, store])
  const getSnapshot = useCallback(() => normalizedRef === ''
    ? undefined
    : store.current(cacheKey), [normalizedRef, cacheKey, store])
  const imageUrl = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)

  useEffect(() => {
    if (normalizedRef === '') return
    void store.load(normalizedRef, cacheKey).catch(() => undefined)
  }, [normalizedRef, cacheKey, store])

  return imageUrl
}
