import type { ClientContext, UseProjection } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import { createElement } from 'react'
import type {} from './harness-slots-contract.js'

const SLOT = 'conversation.session.header.actions'
const LOCALE = 'arkme.harness.sessionSummary'

// Public slot available in the supported host, without bundling its UI package.
declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    'arkme.harness.sessionSummary': 'count'
  }
}

/** Missing/changed projection schemas must not be presented as zero conversations. */
export function sessionTurnCount(value: unknown): number | undefined {
  if (typeof value !== 'object' || value === null || !('turns' in value)) return
  const turns = value.turns
  return typeof turns === 'number' && Number.isSafeInteger(turns) && turns >= 0 ? turns : undefined
}

export function SessionTurnCount({ useProjection, t }: { useProjection: UseProjection; t: TranslateNS<typeof LOCALE> }) {
  // The projection key is owned by the host's optional session-stats plugin.
  // Read the open runtime contract and validate its value instead of copying its schema/fold.
  const projected = (useProjection as (key: string) => unknown)('sessionStats')
  const turns = sessionTurnCount(projected)
  if (turns === undefined) return null
  return createElement('span', { 'data-arkme-session-turn-count': '', 'data-turns': turns }, t('count', { count: turns }))
}

/** Add a session-scoped reader; paging, compaction and push updates stay host-owned. */
export function installHarnessSessionSummary(ctx: ClientContext): () => void {
  if (typeof ctx.locale?.register !== 'function' || typeof ctx.slots.spec !== 'function') return () => {}
  const removeLocale = ctx.locale.register(LOCALE, {
    zh: { count: '{count} 次对话' },
    en: { count: '{count} turns' },
  })
  const removeSlot = ctx.slots.inject(SLOT, () => {
    const spec = ctx.slots.spec(SLOT)
    if (spec?.kind !== 'list' || spec.scope !== 'session') return () => {}
    return ctx.slots.register({ name: SLOT, id: 'arkme-session-turn-count', order: 0, locale: LOCALE }, SessionTurnCount)
  })
  return () => { removeSlot(); removeLocale() }
}
