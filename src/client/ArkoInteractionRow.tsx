import { publishThoughtInvalidation } from './thought-invalidations.js'
import { arkoInteractionJump } from './arko-interaction-jump.js'
import { arkmeSourceIdentityKey } from './source-identity.js'
import { useEffect, useRef, useState } from 'react'
import type { ArkmeArkoInteraction, ArkmeArkoInteractionTarget } from '../arko-timeline-contract.js'
import { callArkme } from './api.js'
import { arkmeTheme as theme } from './arkme-theme.js'
import { arkmeUi } from './ui-controller.js'
import { ArkoChatSuggestionDialog } from './ArkoChatSuggestion.js'
import { arkmeComposerDraftStore, arkmeSourceComposerDraftKey } from './composer-draft-store.js'
import { tr } from './locale.js'
import { recordOwnerId } from '../record-owner-id.js'

export function ArkoInteractionRow({ item, scope, verified = true }: { item: ArkmeArkoInteraction; scope: string; verified?: boolean }) {
  const [target, setTarget] = useState<ArkmeArkoInteractionTarget & { interactionRef: string }>(), [error, setError] = useState(''), [busy, setBusy] = useState(false)
  const controller = useRef<AbortController>()
  useEffect(() => {
    setTarget(undefined);setBusy(false);setError('')
    return () => controller.current?.abort()
  }, [scope, item.interactionRef, verified])
  const open = async () => {
    if (busy || !verified) return
    controller.current?.abort(); const request = new AbortController(); controller.current = request
    setBusy(true); setError('')
    try {
      const next = await callArkme<ArkmeArkoInteractionTarget>('arko.interaction.open', { interactionRef: item.interactionRef }, request.signal)
      if (request.signal.aborted) return
      if (next.accountScope !== scope) throw new Error(tr('账号已切换'))
      if (next.suggestion && next.thought) setTarget({...next,interactionRef:item.interactionRef})
      else {
        arkoInteractionJump.request({ scope, sourceKey: arkmeSourceIdentityKey(next.source), rootUid: next.itemUid, recordOwnerUserId: next.recordOwnerUserId, ...(next.thought ? { thought: next.thought } : {}), ...(next.replyId ? { replyId: next.replyId } : {}) })
        arkmeUi.showConversationTarget(next.source, next.itemUid, next.sourceAtMillis ?? next.occurredAtMillis, recordOwnerId(next.recordOwnerUserId), undefined, false, true)
      }
    } catch (caught) { if (!request.signal.aborted) { setTarget(undefined); publishThoughtInvalidation({accountScope:scope,clear:true}); setError(caught instanceof Error ? caught.message : tr('暂时无法查看互动')) } }
    finally { if (!request.signal.aborted) setBusy(false) }
  }
  return <li data-arko-interaction={item.interactionKey} data-arko-at={item.occurredAtMillis} data-arko-order-at={item.occurredAtMillis} data-arkme-conversation-row={`interaction:${item.interactionKey}`} style={{ listStyle: 'none', margin: '8px 0', width: '100%', textAlign: 'center' }}>
    <button type="button" disabled={!verified} aria-label={verified ? `${tr('互动记录')} · ${item.sourceName} · ${item.summary}` : tr('正在复核互动权限')} aria-busy={busy} onClick={() => { void open() }}
      style={{ display: 'inline-flex', alignItems: 'center', gap: 7, maxWidth: 'min(680px,100%)', padding: '4px 8px', border: 0, background: 'transparent', color: theme.tertiary, font: 'inherit', fontSize: 12, lineHeight: '20px', cursor: 'pointer' }}>
      <span style={{ flex: 'none', color: theme.secondary }}>{tr('互动记录')}</span>
      <span style={{ flex: 'none', maxWidth: 120, overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>{verified ? item.sourceName : tr('正在复核…')}</span>
      <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textAlign: 'left' }}>{verified ? item.summary : ""}</span><span aria-hidden>›</span>
    </button>
    {error && <div role="status" style={{ fontSize: 12, color: theme.tertiary }}>{error}</div>}
    {verified && target?.interactionRef===item.interactionRef && target.accountScope===scope && target.thought && <ArkoChatSuggestionDialog thought={target.thought} scopeKey={`${scope}:${item.interactionKey}`} loading={busy} error={error}
      onRetry={() => { void open() }} onClose={() => setTarget(undefined)} onFill={text => {
        const userId = Number(scope.split(':')[1]), key = arkmeSourceComposerDraftKey(userId, target.source)
        const previous = arkmeComposerDraftStore.get(key).text
        arkmeComposerDraftStore.setText(key, previous.trim() ? `${previous}\n${text}` : text)
        setTarget(undefined); arkmeUi.selectSource(target.source)
      }}/>}
  </li>
}
