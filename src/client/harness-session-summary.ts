import type { ClientContext, UseProjection } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import { createElement } from 'react'
import { DesktopIcon } from '@phosphor-icons/react/dist/csr/Desktop'
import { accountSessionKey, useAccountSessionCatalog } from './harness-account-sessions.js'
import { isRemoteComputer } from './harness-session-origin.js'
import type {} from './harness-slots-contract.js'

const SLOT = 'conversation.session.header.actions'
const LOCALE = 'arkme.harness.sessionSummary'

// Public slot available in the supported host, without bundling its UI package.
declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    'arkme.harness.sessionSummary': 'count' | 'remote'
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

export function SessionComputerLocation({ surface, sessionId, t }: { surface: Element; sessionId: string; t: TranslateNS<typeof LOCALE> }) {
  const { rows, localDesktopName } = useAccountSessionCatalog(surface)
  const row = rows.find(row => !row.archived && accountSessionKey(row) === sessionId)
  if (!row || !isRemoteComputer(row, localDesktopName)) return null
  const name = row.desktopName.trim()
  return createElement('span', { 'data-arkme-session-computer': '', title: `${t('remote')} · ${name}`, tabIndex: 0 },
    createElement(DesktopIcon, { size: 14, 'aria-hidden': true, style: { flexShrink: 0 } }),
    createElement('span', { 'data-arkme-session-remote-label': '' }, t('remote')),
    ' · ',
    createElement('span', { 'data-arkme-session-computer-name': '', title: name }, name))
}

/** Add a session-scoped reader; paging, compaction and push updates stay host-owned. */
export function installHarnessSessionSummary(ctx: ClientContext, surface?: Element): () => void {
  if (typeof ctx.locale?.register !== 'function' || typeof ctx.slots.spec !== 'function') return () => {}
  const removeLocale = ctx.locale.register(LOCALE, {
    zh: { count: '{count} 次对话', remote: '非本机' },
    en: { count: '{count} turns', remote: 'Remote' },
  })
  const removeSlot = ctx.slots.inject(SLOT, () => {
    const spec = ctx.slots.spec(SLOT)
    if (spec?.kind !== 'list' || spec.scope !== 'session') return () => {}
    const removeCount = ctx.slots.register({ name: SLOT, id: 'arkme-session-turn-count', order: 0, locale: LOCALE }, SessionTurnCount)
    const removeComputer = surface && ctx.slots.register({ name: SLOT, id: 'arkme-session-computer', order: 1, locale: LOCALE },
      props => createElement(SessionComputerLocation, { surface, sessionId: props.sessionId, t: props.t }))
    return () => { removeComputer?.(); removeCount() }
  })
  return () => { removeSlot(); removeLocale() }
}
