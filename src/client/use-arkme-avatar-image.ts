import { useCallback, useEffect, useState, useSyncExternalStore, type RefObject } from 'react'
import { arkmeAvatarImages } from './avatar-image-runtime.js'

/** React adapter for one opaque avatar ref; cache and subscription policy stay in the image Port. */
export function useArkmeAvatarImage(imageRef: string | undefined, element?: RefObject<Element>): string | undefined {
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
  const subscribe = useCallback((listener: () => void) => normalizedRef === ''
    ? () => undefined
    : arkmeAvatarImages.subscribe(normalizedRef, () => { listener() }), [normalizedRef])
  const getSnapshot = useCallback(() => normalizedRef === ''
    ? undefined
    : arkmeAvatarImages.current(normalizedRef), [normalizedRef])
  const imageUrl = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)

  useEffect(() => {
    if (normalizedRef === '') return
    void arkmeAvatarImages.load(normalizedRef).catch(() => undefined)
  }, [normalizedRef])

  return imageUrl
}
