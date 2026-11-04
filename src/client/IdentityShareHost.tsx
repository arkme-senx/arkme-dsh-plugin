import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { IdentityShareActionResult, IdentityShareCard } from '../identity-share-contract.js'
import { callArkme } from './api.js'
import { arkmeAuthStore } from './auth-store.js'
import { identityShareTarget } from '../identity-share-link.js'
import { identityPersonCards } from './identity-person-card-client.js'
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
  const [error, setError] = useState(''), [loading, setLoading] = useState(!card), [refreshError, setRefreshError] = useState('')
  const [busy, setBusy] = useState(false), [revision, setRevision] = useState(0)
  const write = useRef<AbortController>(), locked = useRef(false), refreshLocked = useRef(false)
  useEffect(() => {
    let active = true; setError(''); setRefreshError('')
    const request = identityPersonCards.acquire(accountScope, url, revision > 0)
    refreshLocked.current = request.pending; setLoading(request.pending)
    void request.promise.catch(caught => {
      if (active && accountScope === identityShareAccountScope()) {
        if (identityPersonCards.snapshot(accountScope, url)) setRefreshError(tr('更新失败'))
        else setError(caught instanceof Error ? caught.message : tr('名片暂时无法打开'))
      }
    }).finally(() => { if (active) { refreshLocked.current = false; setLoading(false) } })
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
    copyUrl={url} refreshing={loading} refreshError={refreshError}
    person={card} pending={!card} loading={!card && loading} accountName={target?.id ?? ''}
    hideSend={card?.isSelf === true && conversationWindowRequested()} copyLinkTarget={card ? { kind: 'person', userId: card.userId } : undefined} busy={busy} error={error}
    teamContact={card && !card.isSelf && !conversationWindowRequested() ? {
      accountKey: accountScope, person: { recipient: { kind: 'profile-link', url, expectedUserId: card.userId }, displayName: card.displayName, ...(card.avatarRef ? { avatarRef: card.avatarRef } : {}) },
    } : undefined}
    browserUrl={url} onRefresh={() => { if (refreshLocked.current || locked.current || accountScope !== identityShareAccountScope()) return; refreshLocked.current = true; setLoading(true); setRevision(value => value + 1) }} onClose={identityShareUi.close} onSend={submit} />
}

type GroupCard = Extract<IdentityShareCard, { kind: 'group' }>
function IdentityCard({ accountScope, url }: { accountScope: string; url: string }) {
  useArkmeLocale()
  const [card, setCard] = useState<GroupCard>(), [error, setError] = useState(''), [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false), [refreshing, setRefreshing] = useState(false), [refreshError, setRefreshError] = useState('')
  const [copied, setCopied] = useState(false), [now, setNow] = useState(Date.now)
  const write = useRef<AbortController>(), readRequest = useRef<AbortController>(), locked = useRef(false), currentCard = useRef<GroupCard>()
  const stopRead = useCallback(() => { readRequest.current?.abort(); readRequest.current = undefined }, [])
  const read = useCallback(async () => {
    if (readRequest.current || locked.current || accountScope !== identityShareAccountScope() || typeof document !== 'undefined' && document.hidden) return
    const controller = new AbortController(); readRequest.current = controller; setRefreshing(true); setRefreshError('')
    try {
      const value = await callArkme<GroupCard>('identity.share.read', { accountScope, url }, controller.signal)
      if (controller.signal.aborted || accountScope !== identityShareAccountScope()) return
      if (value.kind !== 'group') throw new Error(tr('名片暂时无法打开'))
      currentCard.current = value; setCard(value); setError(''); setNow(Date.now())
    } catch (caught) {
      if (controller.signal.aborted || accountScope !== identityShareAccountScope()) return
      const message = caught instanceof Error ? caught.message : tr('名片暂时无法打开')
      const code = (caught as { body?: { code?: string } })?.body?.code
      if (!currentCard.current || ['identity-share-group-unavailable', 'identity-share-invalid', 'identity-share-environment-mismatch'].includes(code ?? '')) {
        currentCard.current = undefined; setCard(undefined); setError(message)
      } else setRefreshError(tr('更新失败'))
    } finally {
      if (readRequest.current === controller) { readRequest.current = undefined; if (!controller.signal.aborted) { setRefreshing(false); setLoading(false) } }
    }
  }, [accountScope, url])
  useEffect(() => {
    void read()
    const visibility = () => {
      setNow(Date.now())
      if (document.hidden) { stopRead(); setRefreshing(false) }
      else void read()
    }
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', visibility)
    return () => { stopRead(); write.current?.abort(); if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', visibility) }
  }, [read, stopRead])
  useEffect(() => {
    if (!card?.requestPending || card.hasJoined) return
    const timer = setInterval(() => { void read() }, 10_000)
    return () => clearInterval(timer)
  }, [card?.requestPending, card?.hasJoined, read])
  useEffect(() => {
    if (!card || card.hasJoined) return
    let timer: ReturnType<typeof setTimeout>
    const update = () => {
      setNow(Date.now())
      const remaining = card.expireAtMillis - Date.now()
      if (remaining > 0) timer = setTimeout(update, Math.min(remaining + 1, 2_147_483_647))
    }
    update()
    return () => clearTimeout(timer)
  }, [card?.expireAtMillis, card?.hasJoined])
  const submit = () => {
    if (!card || locked.current || loading || accountScope !== identityShareAccountScope()) return
    stopRead(); setRefreshing(false)
    const controller = new AbortController(); write.current = controller; locked.current = true; setBusy(true); setError('')
    void callArkme<IdentityShareActionResult>(card.hasJoined ? 'identity.share.open' : 'identity.share.join', { accountScope, url }, controller.signal)
      .then(async result => {
        if (controller.signal.aborted || accountScope !== identityShareAccountScope()) return
        if (result.status === 'pending') {
          const updated = { ...card, requestPending: true }; currentCard.current = updated; setCard(updated); return
        }
        if (conversationWindowRequested()) await navigateConversationWindow(result.source)
        else { arkmeChatDirectory.upsert(result.source); arkmeUi.selectSource(result.source); arkmeUi.chatChanged() }
        if (!controller.signal.aborted && accountScope === identityShareAccountScope()) identityShareUi.close()
      }).catch(caught => { if (!controller.signal.aborted) setError(caught instanceof Error ? caught.message : tr('操作失败，请重试')) })
      .finally(() => { if (write.current === controller) { locked.current = false; if (!controller.signal.aborted) setBusy(false) } })
  }
  const copyGroupLink = async () => {
    if (accountScope !== identityShareAccountScope()) return
    try { await navigator.clipboard.writeText(url); if (accountScope === identityShareAccountScope()) setCopied(true) }
    catch { setError(tr('复制失败，请重试')) }
  }
  const expired = card && !card.hasJoined && card.expireAtMillis <= now
  const pending = card && !card.hasJoined && card.requestPending
  const label = card?.hasJoined ? '打开群聊' : pending ? '等待审批' : expired ? '邀请已过期' : card?.joinMode === 2 ? '申请加入' : '加入群聊'
  return <ArkmeConfirmDialog titleId="arkme-identity-card-title" dialogStyle={{ overflowWrap: 'anywhere' }} title={card?.displayName || tr('名片')} description={tr('群聊名片')} busy={busy} error={error}
    confirmLabel={tr(label)} busyLabel={tr('正在处理…')} confirmDisabled={!card || loading || Boolean(expired || pending)} onClose={identityShareUi.close} onConfirm={submit}>
    <div style={{ paddingTop: 18, display: 'grid', gap: 12, overflowWrap: 'anywhere' }}>
      {loading && <p role="status" style={{ color: t.secondary }}>{tr('正在读取名片…')}</p>}
      {card && <>
        <p style={{ margin: 0, color: t.secondary }}>{tr('群主：')}{card.creatorDisplayName}</p>
        <p style={{ margin: 0, color: t.secondary }}>{tr(card.hasJoined ? '你已在此群聊中' : card.joinMode === 2 ? '加入此群需要审批' : '点击加入后即可进入群聊')}</p>
        <p style={{ margin: 0, fontSize: 12, color: t.secondary }}>{tr('邀请有效期至：')}{new Date(card.expireAtMillis).toLocaleString()}</p>
        <button type="button" style={smallButton} disabled={busy} aria-label={tr('复制群聊链接')} onClick={() => { void copyGroupLink() }}>{tr(copied ? '链接已复制' : '复制群聊链接')}</button>
      </>}
      {!loading && <button type="button" style={smallButton} disabled={busy || refreshing} onClick={() => { void read() }}>{tr('刷新名片')}</button>}
      <span role="status" style={{ color: t.secondary, fontSize: 12 }}>{refreshing && card ? tr('更新中…') : refreshError && <>{refreshError} <button type="button" style={{ ...smallButton, padding: '2px 6px' }} disabled={busy} onClick={() => { void read() }}>{tr('重试')}</button></>}</span>
      <a href={url} target="_blank" rel="noopener noreferrer" style={{ color: t.accent, fontSize: 12 }}>{tr('在浏览器中打开')}</a>
    </div>
  </ArkmeConfirmDialog>
}

const smallButton = { padding: '7px 10px', border: `1px solid ${t.border}`, borderRadius: 8, color: t.text, background: t.elevated, cursor: 'pointer', font: 'inherit', fontSize: 13 }
