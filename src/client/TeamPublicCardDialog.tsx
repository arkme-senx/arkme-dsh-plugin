import { useEffect, useState, type CSSProperties } from 'react'
import type { TeamPublicCard } from '../team-group-contract.js'
import { TEAM_GROUP_PENDING_TEXT } from '../team-group-contract.js'
import { callArkme } from './api.js'
import { ArkmeTeamAvatar } from './ArkmeTeamAvatar.js'
import { arkmeTheme } from './arkme-theme.js'
import { tr, useArkmeLocale } from './locale.js'
import { TeamFeatureDialog } from './redesign/contacts/TeamFeatureDialog.js'
import { openTeamMessages } from './team-messaging-events.js'

type Props = { accountKey: string; jotmoId: string; onClose(): void }
export function TeamPublicCardDialog(props: Props) {
  return <ScopedCard key={JSON.stringify([props.accountKey, props.jotmoId])} {...props} />
}

function ScopedCard({ accountKey, jotmoId, onClose }: Props) {
  useArkmeLocale()
  const [card, setCard] = useState<TeamPublicCard>(), [error, setError] = useState('')
  const [attempt, setAttempt] = useState(0), [notice, setNotice] = useState(false)
  useEffect(() => {
    const controller = new AbortController()
    setCard(undefined); setError(''); setNotice(false)
    void callArkme<TeamPublicCard>('team.app.public-card', { expectedAccountKey: accountKey, jotmoId }, controller.signal).then(value => {
      if (controller.signal.aborted) return
      if (value.jotmoId !== jotmoId || !value.name || !['available', 'disabled', 'backend_pending'].includes(value.contact?.state)
        || (value.contact.state === 'available' && !value.contact.publicRef)) throw new Error(tr('团队资料返回异常，请重试'))
      setCard(value)
    }).catch(caught => { if (!controller.signal.aborted) setError(caught instanceof Error ? caught.message : tr('团队资料加载失败，请重试')) })
    return () => controller.abort()
  }, [accountKey, jotmoId, attempt])
  const contact = () => {
    if (!card || card.contact.state === 'disabled') return
    if (card.contact.state === 'backend_pending') { setNotice(true); return }
    onClose()
    // Existing link navigation opens the canonical team conversation/inbox.
    // Merely reading the card never opens a conversation or sends a message.
    openTeamMessages({ kind: 'link', publicRef: card.contact.publicRef })
  }
  return <TeamFeatureDialog title={tr('团队资料')} teamName={card?.name ?? `@${jotmoId}`} className="arkme-team-public-card" onClose={onClose}
    footer={<button type="button" disabled={!card || card.contact.state === 'disabled'} onClick={contact}>{tr('联系团队')}</button>}>
    <style>{`.arkme-contact-remark-dialog.arkme-team-public-card { width:min(440px,100%); }`}</style>
    <div style={styles.body}>
      {!card && !error && <p role="status">{tr('正在加载团队资料…')}</p>}
      {error && <p role="alert">{error} <button type="button" style={styles.link} onClick={() => setAttempt(value => value + 1)}>{tr('重试')}</button></p>}
      {card && <>
        <div style={styles.identity}><ArkmeTeamAvatar name={card.name} avatar={card.avatar} size={56} /><div style={{ minWidth: 0 }}>
          <strong style={{ display: 'block', fontSize: 18, overflowWrap: 'anywhere' }}>{card.name}</strong><span style={styles.hint}>@{card.jotmoId}</span>
        </div></div>
        <p style={styles.hint}>{tr('通过团队消息通道联系，团队成员可共同查看和处理。')}</p>
        {card.contact.state === 'disabled' && <p role="status" style={styles.hint}>{tr('该团队暂未开放消息通道。')}</p>}
        {card.contact.state === 'backend_pending' && <div role="status" style={styles.notice}>
          <strong>{tr(TEAM_GROUP_PENDING_TEXT)}</strong>
          <p style={{ ...styles.hint, marginBottom: 0 }}>{tr(notice ? '尚未打开团队通道，也未发送消息。' : '该团队的公开联系入口尚待接入。')}</p>
        </div>}
      </>}
    </div>
  </TeamFeatureDialog>
}

const styles: Record<string, CSSProperties> = {
  body: { padding: 20, fontSize: 13 },
  identity: { display: 'flex', alignItems: 'center', gap: 14 },
  hint: { fontSize: 12, lineHeight: 1.7, color: arkmeTheme.secondary },
  link: { border: 0, background: 'transparent', padding: 6, color: arkmeTheme.accent, cursor: 'pointer' },
  notice: { padding: 12, borderRadius: 10, background: arkmeTheme.subtle, lineHeight: 1.7 },
}
