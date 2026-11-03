import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { IdentityShareActionResult, IdentityShareCard } from '../identity-share-contract.js'
import { callArkme } from './api.js'
import { arkmeAuthStore } from './auth-store.js'
import { ArkmeConfirmDialog } from './ArkmeConfirmDialog.js'
import { ArkmeUserAvatar } from './ArkmeAvatar.js'
import { IdentityCopyLinkButton } from './IdentityCopyLinkButton.js'
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
  return request && request.accountScope === scope ? <IdentityCard key={`${scope}:${request.url}`} accountScope={scope} url={request.url} /> : null
}

function IdentityCard({ accountScope, url }: { accountScope: string; url: string }) {
  useArkmeLocale()
  const [card, setCard] = useState<IdentityShareCard>(), [error, setError] = useState(''), [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false), [revision, setRevision] = useState(0)
  const [copied, setCopied] = useState(false)
  const write = useRef<AbortController>(), locked = useRef(false)
  useEffect(() => {
    const controller = new AbortController(); setLoading(true); setError(''); setCard(undefined)
    void callArkme<IdentityShareCard>('identity.share.read', { accountScope, url }, controller.signal)
      .then(value => { if (!controller.signal.aborted) setCard(value) })
      .catch(e => { if (!controller.signal.aborted) setError(e instanceof Error ? e.message : tr('名片暂时无法打开')) })
      .finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [accountScope, url, revision])
  useEffect(() => () => write.current?.abort(), [])
  const world = () => {
    if (card?.kind !== 'person' || accountScope !== identityShareAccountScope()) return
    if (conversationWindowRequested()) { window.open(url, '_blank', 'noopener,noreferrer'); return }
    arkmeUi.showUserWorld({ userId: card.userId, displayName: card.displayName, ...(card.avatarRef ? { avatarRef: card.avatarRef } : {}) }); identityShareUi.close()
  }
  const submit = () => {
    if (!card || locked.current || loading) return
    if (card.kind === 'person' && card.isSelf) { world(); return }
    const controller = new AbortController(); write.current = controller; locked.current = true; setBusy(true); setError('')
    const operation = card.kind === 'group' && !card.hasJoined ? 'identity.share.join' : 'identity.share.open'
    void callArkme<IdentityShareActionResult>(operation, { accountScope, url, ...(card.kind === 'person' ? { expectedUserId: card.userId } : {}) }, controller.signal)
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
  const label = card?.kind === 'person' ? card.isSelf ? '查看我的世界' : '发消息' : card?.hasJoined ? '打开群聊' : pending ? '等待审批' : expired ? '邀请已过期' : card?.joinMode === 2 ? '申请加入' : '加入群聊'
  return <ArkmeConfirmDialog titleId="arkme-identity-card-title" dialogStyle={{ overflowWrap: 'anywhere' }} title={card?.displayName || tr('名片')} description={tr(card?.kind === 'group' ? '群聊名片' : '联系人名片')} busy={busy} error={error}
    confirmLabel={tr(label)} busyLabel={tr('正在处理…')} confirmDisabled={!card || loading || Boolean(expired || pending)} onClose={identityShareUi.close} onConfirm={submit}>
    <div style={{ paddingTop: 18, display: 'grid', gap: 12, overflowWrap: 'anywhere' }}>
      {loading && <p role="status" style={{ color: t.secondary }}>{tr('正在读取名片…')}</p>}
      {card?.kind === 'person' && <>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}><ArkmeUserAvatar avatarRef={card.avatarRef} {...(card.avatarFallback ? { fallback: card.avatarFallback } : {})} size={60} /><span style={{ color: t.secondary }}>{tr('即我号：')}{card.accountName}</span></div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}><button type="button" style={smallButton} disabled={busy} onClick={world}>{tr('查看世界')}</button><IdentityCopyLinkButton accountScope={accountScope} target={{ kind: 'person', userId: card.userId }} label="复制个人链接" /></div>
      </>}
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
