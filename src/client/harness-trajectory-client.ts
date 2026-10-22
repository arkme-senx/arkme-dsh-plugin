import type { Context as ClientContext } from '@deepseek-ai/cordis'
import { installHarnessTrajectoryMenu } from './harness-trajectory-menu.js'
import { installHarnessScheduleFeedback } from './harness-schedule-feedback.js'

export const inject: string[] = []

/** This client is added only to the Arkme-owned native Harness iframe. */
export function apply(ctx: ClientContext): void {
  if (typeof document === 'undefined' || typeof window === 'undefined'
    || new URLSearchParams(window.location.search).get('arkme-harness-embed') !== '1') return
  ctx.effect(() => installHarnessTrajectoryMenu(document), 'arkme: native Harness trajectory navigation')
  ctx.effect(() => installHarnessScheduleFeedback(document), 'arkme: native Harness reminder feedback')
}
