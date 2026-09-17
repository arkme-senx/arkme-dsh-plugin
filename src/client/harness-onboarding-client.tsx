import type { ClientContext, ISessions } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import { useEffect } from 'react'
import { homeTourDiagnostic } from './home-tour-diagnostics.js'
import { loadNativeSelection } from './harness-native-selection-loader.js'

export const inject = ['slots', 'sessions', 'modules']

/** Runs in the native iframe. The settings coordinator owns when this step mounts. */
export function apply(ctx: ClientContext): void {
  const sessions = (ctx as unknown as { sessions: ISessions }).sessions
  let completed = false
  let wasActive: boolean | undefined
  let selectionStarted = false
  let disposeSelection: (() => void) | undefined
  let selectionTimer: ReturnType<typeof setTimeout> | undefined
  const publish = () => {
    const snapshot = sessions.list.getSnapshot()
    const active = snapshot.phase === 'ready' && (snapshot.current === undefined || snapshot.byId[snapshot.current]?.blank === true)
    if (active && wasActive === false) completed = false
    wasActive = active
    const ready = snapshot.phase === 'ready' && (!active || completed)
    const state = ready ? 'ready' : 'pending'
    if (ready && !selectionStarted) {
      const asset = document.querySelector<HTMLMetaElement>('meta[name="arkme-native-selection"]')?.content
      if (asset && /^\/arkme-self\/harness-native-selection-client\.js\?rev=[a-f0-9]+$/.test(asset)) {
        selectionStarted = true
        // A separate task keeps optional loading outside the native readiness callback.
        selectionTimer = setTimeout(() => {
          try { disposeSelection = loadNativeSelection(ctx, document, asset) }
          catch (error) { console.warn('Arkme native selection could not start.', error) }
        }, 0)
      }
    }
    if (document.body.dataset.arkmeHarnessOnboarding !== state) {
      document.body.dataset.arkmeHarnessOnboarding = state
      homeTourDiagnostic('harness-onboarding-state', { state, active, completed })
    }
  }
  function OnboardingComplete({ complete }: { complete(): void }) {
    useEffect(() => {
      completed = true
      publish()
      complete()
    }, [complete])
    return null
  }
  ctx.effect(() => {
    publish()
    const unsubscribe = sessions.list.subscribe(publish)
    return () => {
      unsubscribe()
      clearTimeout(selectionTimer)
      disposeSelection?.()
      delete document.body.dataset.arkmeHarnessOnboarding
    }
  }, 'arkme: native onboarding readiness')
  ctx.slots.inject('settings.onboarding', () => ctx.slots.register({
    name: 'settings.onboarding', id: 'arkme-home-ready', order: Number.MAX_SAFE_INTEGER,
  }, OnboardingComplete))
}
