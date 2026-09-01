import { useCallback, useEffect, useSyncExternalStore } from 'react'
import { arkmeAvatarImages } from './avatar-image-runtime.js'

/** React adapter for one opaque avatar ref; cache and subscription policy stay in the image Port. */
export function useArkmeAvatarImage(imageRef: string | undefined): string | undefined {
  const normalizedRef = imageRef?.trim() ?? ''
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
