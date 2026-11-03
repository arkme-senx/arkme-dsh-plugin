import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { IdentityShareActionResult, IdentityShareCard } from '../identity-share-contract.js'
import { callArkme } from './api.js'
import { arkmeAuthStore } from './auth-store.js'
import { identityShareTarget } from '../identity-share-link.js'
import { identityPersonCards } from './identity-person-card-client.js'
import { openTeamOutbound } from './team-outbound.js'
import { ArkmeConfirmDialog } from './ArkmeConfirmDialog.js'
import { ArkmeMemberProfileCard } from './ArkmeChatMemberActions.js'
import { identityShareAccountScope, identityShareUi } from './identity-share-ui.js'
import { arkmeUi } from './ui-controller.js'
import { tr, useArkmeLocale } from './locale.js'
import { arkmeTheme as t } from './arkme-theme.js'
import { conversationWindowRequested, navigateConversationWindow } from './conversation-window.js'
import { arkmeChatDirectory } from './chat-directory-store.js'

export function IdentityShareHost() {
  const request = useSyncExternalStore(identityShareUi.subscribe, identityShareUi.getSnapshot, () => undefined)
  const scope = useSyncExternalStore(arkmeAuthStore.subscribe, identityShareAccountScope, () => '')
  useEffect(() => { if (request && request.accountScope !== scope) identityShareUi.close() }, [scope, request])
  if (!request || request.accountScope !== scope) return null
  return identityShareTarget(request.url)?.kind === 'world'
    ? <IdentityPersonCard key={`${scope}:${request.url}`} accountScope={scope} url={request.url} {...(request.displayName ? { displayName: request.displayName } : {})} />
    : <IdentityCard key={`${scope}:${request.url}`} accountScope={scope} url={request.url} />
}

function IdentityPersonCard({ accountScope, url, displayName }: { accountScope: string; url: string; displayName?: string }) {
  useArkmeLocale()
  const entry = useSyncExternalStore(identityPersonCards.subscribe, () => identityPersonCards.snapshot(accountScope, url), () => undefined)
  const card = entry?.card, target = identityShareTarget(url)
  const [error, setError] = useState(''), [loading, setLoading] = useState(!card)
  const [busy, setBusy] = useState(false), [revision, setRevision] = useState(0)
  const write = useRef<AbortController>(), locked = useRef(false)
  useEffect(() => {
    let active = true; setLoading(true); setError('')
    const request = identityPersonCards.acquire(accountScope, url, revision > 0)
    void request.promise.catch(caught => {
      if (active && accountScope === identityShareAccountScope()) setError(caught instanceof Error ? caught.message : tr('名片暂时无法打开'))
    }).finally(() => { if (active) setLoading(false) })
    return () => { active = false; request.release() }
  }, [accountScope, url, revision])
  useEffect(() => () => write.current?.abort(), [])
  const submit = () => {
    if (!card || locked.current || accountScope !== identityShareAccountScope()) return
    if (card.isSelf) { arkmeUi.focusSendToSelf(); arkmeUi.chatChanged(); identityShareUi.close(); return }
    const controller = new AbortController(); write.current = controller; locked.current = true; setBusy(true); setError('')
    void callArkme<IdentityShareActionResult>('identity.share.open', { accountScope, url, expectedUserId: card.userId }, controller.signal)
      .then(async result => {
        if (controller.signal.aborted || accountScope !== identityShareAccountScope() || result.status !== 'opened') return
        if (conversationWindowRequested()) await navigateConversationWindow(result.source)
        else { arkmeChatDirectory.upsert(result.source); arkmeUi.selectSource(result.source); arkmeUi.chatChanged() }
        if (!controller.signal.aborted && accountScope === identityShareAccountScope()) identityShareUi.close()
      }).catch(caught => {
        if (!controller.signal.aborted) {
          if (['identity-share-person-changed', 'identity-share-person-unavailable'].includes(caught?.body?.code)) identityPersonCards.invalidate(accountScope, url)
          setError(caught instanceof Error ? caught.message : tr('操作失败，请重试'))
        }
      }).finally(() => { if (write.current === controller) { locked.current = false; if (!controller.signal.aborted) setBusy(false) } })
  }
  return <ArkmeMemberProfileCard
    member={{ displayName: card?.displayName || displayName || target?.id || tr('联系人名片'), ...(card?.avatarRef ? { avatarRef: card.avatarRef } : {}), ...(card?.avatarFallback ? { avatarFallback: card.avatarFallback } : {}) }}
    person={card} pending={!card} loading={!card && loading} accountName={target?.id ?? ''}
    hideSend={card?.isSelf === true && conversationWindowRequested()} copyLinkTarget={card ? { kind: 'person', userId: card.userId } : undefined} busy={busy} error={error}
    onContactAsTeam={card && !card.isSelf && !conversationWindowRequested() ? () => {
      if (accountScope !== identityShareAccountScope()) return
      openTeamOutbound({ accountKey: accountScope, person: { recipient: { kind: 'profile-link', url, expectedUserId: card.userId }, displayName: card.displayName, ...(card.avatarRef ? { avatarRef: card.avatarRef } : {}) } })
      identityShareUi.close()
    } : undefined}
    browserUrl={url} onRefresh={() => setRevision(value => value + 1)} onClose={identityShareUi.close} onSend={submit} />
}

function IdentityCard({ accountScope, url }: { accountScope: string; url: string }) {
  useArkmeLocale()
  const [card, setCard] = useState<Extract<IdentityShareCard, { kind: 'group' }>>(), [error, setError] = useState(''), [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false), [revision, setRevision] = useState(0)
  const [copied, setCopied] = useState(false)
  const write = useRef<AbortController>(), locked = useRef(false)
  useEffect(() => {
    const controller = new AbortController(); setLoading(true); setError('')
    void callArkme<Extract<IdentityShareCard, { kind: 'group' }>>('identity.share.read', { accountScope, url }, controller.signal)
      .then(value => { if (!controller.signal.aborted) setCard(value) })
      .catch(e => { if (!controller.signal.aborted) setError(e instanceof Error ? e.message : tr('名片暂时无法打开')) })
      .finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [accountScope, url, revision])
  useEffect(() => () => write.current?.abort(), [])
  const submit = () => {
    if (!card || locked.current || loading) return
    const controller = new AbortController(); write.current = controller; locked.current = true; setBusy(true); setError('')
    const operation = card.kind === 'group' && !card.hasJoined ? 'identity.share.join' : 'identity.share.open'
    void callArkme<IdentityShareActionResult>(operation, { accountScope, url }, controller.signal)
      .then(async result => {
        if (controller.signal.aborted || accountScope !== identityShareAccountScope()) return
        if (result.status === 'pending') { setCard(old => old?.kind === 'group' ? { ...old, requestPending: true } : old); return }
        if (conversationWindowRequested()) await navigateConversationWindow(result.source)
        else { arkmeChatDirectory.upsert(result.source); arkmeUi.selectSource(result.source); arkmeUi.chatChanged() }
        if (!controller.signal.aborted && accountScope === identityShareAccountScope()) identityShareUi.close()
      }).catch(e => { if (!controller.signal.aborted) setError(e instanceof Error ? e.message : tr('操作失败，请重试')) })
      .finally(() => { if (write.current === controller) { locked.current = false; if (!controller.signal.aborted) setBusy(false) } })
  }
  const copyGroupLink = async () => {
    if (accountScope !== identityShareAccountScope()) return
    try { await navigator.clipboard.writeText(url); if (accountScope === identityShareAccountScope()) setCopied(true) }
    catch { setError(tr('复制失败，请重试')) }
  }
  const expired = card?.kind === 'group' && !card.hasJoined && card.expireAtMillis <= Date.now()
  const pending = card?.kind === 'group' && !card.hasJoined && card.requestPending
  const label = card?.hasJoined ? '打开群聊' : pending ? '等待审批' : expired ? '邀请已过期' : card?.joinMode === 2 ? '申请加入' : '加入群聊'
  return <ArkmeConfirmDialog titleId="arkme-identity-card-title" dialogStyle={{ overflowWrap: 'anywhere' }} title={card?.displayName || tr('名片')} description={tr('群聊名片')} busy={busy} error={error}
    confirmLabel={tr(label)} busyLabel={tr('正在处理…')} confirmDisabled={!card || loading || Boolean(expired || pending)} onClose={identityShareUi.close} onConfirm={submit}>
    <div style={{ paddingTop: 18, display: 'grid', gap: 12, overflowWrap: 'anywhere' }}>
      {loading && <p role="status" style={{ color: t.secondary }}>{tr('正在读取名片…')}</p>}
      {card?.kind === 'group' && <>
        <p style={{ margin: 0, color: t.secondary }}>{tr('群主：')}{card.creatorDisplayName}</p>
        <p style={{ margin: 0, color: t.secondary }}>{tr(card.hasJoined ? '你已在此群聊中' : card.joinMode === 2 ? '加入此群需要审批' : '点击加入后即可进入群聊')}</p>
        <p style={{ margin: 0, fontSize: 12, color: t.secondary }}>{tr('邀请有效期至：')}{new Date(card.expireAtMillis).toLocaleString()}</p>
        <button type="button" style={smallButton} disabled={busy} aria-label={tr('复制群聊链接')} onClick={() => { void copyGroupLink() }}>{tr(copied ? '链接已复制' : '复制群聊链接')}</button>
      </>}
      {!loading && <button type="button" style={smallButton} disabled={busy} onClick={() => setRevision(v => v + 1)}>{tr('刷新名片')}</button>}
      <a href={url} target="_blank" rel="noopener noreferrer" style={{ color: t.accent, fontSize: 12 }}>{tr('在浏览器中打开')}</a>
    </div>
  </ArkmeConfirmDialog>
}
const smallButton = { padding: '7px 10px', border: `1px solid ${t.border}`, borderRadius: 8, color: t.text, background: t.elevated, cursor: 'pointer', font: 'inherit', fontSize: 13 }
