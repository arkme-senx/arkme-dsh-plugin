import type { ClientContext, ISessions } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import { useEffect } from 'react'
import { homeTourDiagnostic } from './home-tour-diagnostics.js'

export const inject = ['slots', 'sessions']

/** Runs in the native iframe. The settings coordinator owns when this step mounts. */
export function apply(ctx: ClientContext): void {
  const sessions = (ctx as unknown as { sessions: ISessions }).sessions
  let completed = false
  let wasActive: boolean | undefined
  const publish = () => {
    const snapshot = sessions.list.getSnapshot()
    const active = snapshot.phase === 'ready' && (snapshot.current === undefined || snapshot.byId[snapshot.current]?.blank === true)
    if (active && wasActive === false) completed = false
    wasActive = active
    const ready = snapshot.phase === 'ready' && (!active || completed)
    const state = ready ? 'ready' : 'pending'
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
      delete document.body.dataset.arkmeHarnessOnboarding
    }
  }, 'arkme: native onboarding readiness')
  ctx.slots.inject('settings.onboarding', () => ctx.slots.register({
    name: 'settings.onboarding', id: 'arkme-home-ready', order: Number.MAX_SAFE_INTEGER,
  }, OnboardingComplete))
}
