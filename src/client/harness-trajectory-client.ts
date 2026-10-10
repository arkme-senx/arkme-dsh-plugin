import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import { installHarnessTrajectoryMenu } from './harness-trajectory-menu.js'

export const inject: string[] = []

/** This client is added only to the Arkme-owned native Harness iframe. */
export function apply(ctx: ClientContext): void {
  if (typeof document === 'undefined' || typeof window === 'undefined'
    || new URLSearchParams(window.location.search).get('arkme-harness-embed') !== '1') return
  ctx.effect(() => installHarnessTrajectoryMenu(document), 'arkme: native Harness trajectory navigation')
}
