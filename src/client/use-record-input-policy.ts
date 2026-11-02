import {useCallback,useEffect,useRef,useState,useSyncExternalStore} from 'react'
import type {ArkmeProviderCapabilities,ArkmeBackgroundSoundEligibilityReason,ArkmeBackgroundSoundPreference} from '../types.js'
import {callArkme} from './api.js'
import {arkmeAuthStore} from './auth-store.js'
import {retryArkmeRead} from './read-retry.js'
import {applyArkmeBackgroundSoundOwnerSnapshot,arkmeBackgroundSoundCaptureEnabled,arkmeBackgroundSoundServerPreferenceRuntime,subscribeArkmeBackgroundSoundCapturePreference} from './record-input-capture.js'

/** One capability/preference gate for ordinary and Team Record input. */
export function useArkmeRecordInputPolicy(authenticatedAccountKey: string|undefined, authenticatedUserId: number|undefined, activeConversation: boolean) {
  const [markdownQuickNotesEnabled, setMarkdownQuickNotesEnabled] = useState(false)
  const [backgroundSoundSupported, setBackgroundSoundSupported] = useState(false)
  const [backgroundSoundCapabilityKnown, setBackgroundSoundCapabilityKnown] = useState(false)
  const [backgroundSoundEligibilityReason, setBackgroundSoundEligibilityReason] = useState<ArkmeBackgroundSoundEligibilityReason>('membership-unavailable')
  const backgroundSoundAccountGenerationRef = useRef(0)
  useEffect(() => {
    const generation = backgroundSoundAccountGenerationRef.current + 1
    backgroundSoundAccountGenerationRef.current = generation
    setBackgroundSoundSupported(false)
    setBackgroundSoundCapabilityKnown(false)
    setBackgroundSoundEligibilityReason('membership-unavailable')
    if (!activeConversation || authenticatedUserId === undefined || authenticatedAccountKey === undefined) return
    const targetUserId = authenticatedUserId
    const targetAccountKey = authenticatedAccountKey
    let alive = true
    let controller: AbortController | undefined
    const refresh = () => {
      const readToken = arkmeBackgroundSoundServerPreferenceRuntime.beginRead(targetAccountKey)
      if (!arkmeBackgroundSoundServerPreferenceRuntime.current(readToken)) return
      controller?.abort()
      const requestController = new AbortController()
      controller = requestController
      const sameAccount = () => {
        const current = arkmeAuthStore.getSnapshot().auth
        return alive
          && !requestController.signal.aborted
          && activeConversation
          && backgroundSoundAccountGenerationRef.current === generation
          && arkmeBackgroundSoundServerPreferenceRuntime.current(readToken)
          && (current?.status === 'authenticated' ? `${current.environment}:${String(current.userId)}` : undefined) === targetAccountKey
      }
      void Promise.all([
        retryArkmeRead(
          () => callArkme<ArkmeProviderCapabilities>('provider.capabilities', {}, requestController.signal),
          { signal: requestController.signal, retryDelays: [250, 750] },
        ).catch(() => undefined),
        retryArkmeRead(
          () => callArkme<ArkmeBackgroundSoundPreference>('settings.background-sound.get', undefined, requestController.signal),
          { signal: requestController.signal, retryDelays: [250, 750] },
        ).catch(() => undefined),
      ]).then(([capabilities, preference]) => {
        if (!sameAccount()) return
        if (!capabilities || !capabilities.features || typeof capabilities.features !== 'object') return
        setBackgroundSoundCapabilityKnown(true)
        setMarkdownQuickNotesEnabled(capabilities.features.markdownQuickNotes === true)
        const supported = capabilities.features.backgroundSound === true
        setBackgroundSoundSupported(supported)
        if (!supported) return
        if (preference === undefined) {
          return
        }
        if (applyArkmeBackgroundSoundOwnerSnapshot(targetAccountKey, preference, undefined, targetUserId)) setBackgroundSoundEligibilityReason(preference.eligibilityReason)
      }).catch(() => undefined)
    }
    const unsubscribeRuntime = arkmeBackgroundSoundServerPreferenceRuntime.subscribe(targetAccountKey, refresh)
    refresh()
    return () => {
      alive = false
      controller?.abort()
      unsubscribeRuntime()
    }
  }, [activeConversation, authenticatedAccountKey, authenticatedUserId])
  const backgroundSoundCaptureEnabled = useSyncExternalStore(
    useCallback((listener: () => void) => subscribeArkmeBackgroundSoundCapturePreference(authenticatedAccountKey, listener), [authenticatedAccountKey]),
    useCallback(() => arkmeBackgroundSoundCaptureEnabled(authenticatedAccountKey), [authenticatedAccountKey]), () => false)
  return { markdownQuickNotesEnabled, backgroundSoundSupported, backgroundSoundCapabilityKnown, backgroundSoundEligibilityReason, backgroundSoundCaptureEnabled }
}
