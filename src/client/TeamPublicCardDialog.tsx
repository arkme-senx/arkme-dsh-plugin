import { useEffect, useState, type CSSProperties } from 'react'
import type { TeamPublicCard } from '../team-group-contract.js'
import type { TeamChannel } from '../team-app-contract.js'
import { callArkme } from './api.js'
import { ArkmeTeamAvatar } from './ArkmeTeamAvatar.js'
import { arkmeTheme } from './arkme-theme.js'
import { tr, useArkmeLocale } from './locale.js'
import { TeamFeatureDialog } from './redesign/contacts/TeamFeatureDialog.js'
import { invalidateTeamMessages, openTeamMessages } from './team-messaging-events.js'
import { TeamMembershipForm } from './redesign/contacts/TeamDirectoryActions.js'
import { arkmeContactsTab } from './redesign/contacts/contacts-tab-store.js'
import { arkmeUi } from './ui-controller.js'

type Props = { accountKey: string; jotmoId: string; currentChannel?: TeamChannel; onClose(): void }
export function TeamPublicCardDialog(props: Props) {
  return <ScopedCard key={JSON.stringify([props.accountKey, props.jotmoId])} {...props} />
}

function ScopedCard({ accountKey, jotmoId, currentChannel, onClose }: Props) {
  useArkmeLocale()
  const [card, setCard] = useState<TeamPublicCard>(), [error, setError] = useState('')
  const [attempt, setAttempt] = useState(0)
  const [creating, setCreating] = useState(false)
  const inCurrentConversation = currentChannel?.jotmoId === jotmoId
  useEffect(() => {
    if(currentChannel?.jotmoId===jotmoId){
      setError('');setCard({name:currentChannel.name,jotmoId,avatar:currentChannel.avatar,contact:currentChannel.enabled&&currentChannel.publicRef?{state:'available',publicRef:currentChannel.publicRef}:{state:'disabled'}});return
    }
    const controller = new AbortController()
    setCard(undefined); setError('')
    void callArkme<TeamPublicCard>('team.app.public-card', { expectedAccountKey: accountKey, jotmoId }, controller.signal).then(value => {
      if (controller.signal.aborted) return
      if (value.jotmoId !== jotmoId || value.contact?.state !== 'unavailable' && !value.name || !['available', 'disabled', 'unavailable'].includes(value.contact?.state)
        || (value.contact.state === 'available' && !value.contact.publicRef)) throw new Error(tr('团队资料返回异常，请重试'))
      setCard(value)
    }).catch(caught => { if (!controller.signal.aborted) setError(caught instanceof Error ? caught.message : tr('团队资料加载失败，请重试')) })
    return () => controller.abort()
  }, [accountKey, jotmoId, attempt, currentChannel])
  const contact = () => {
    if (!card) return
    if(card.navigation?.kind==='inbox'&&card.navigation.teamRef){onClose();openTeamMessages({kind:'team',teamRef:card.navigation.teamRef});return}
    if(card.contact.state==='disabled'||card.contact.state==='unavailable')return
    onClose()
    // Existing link navigation opens the canonical team conversation/inbox.
    // Merely reading the card never opens a conversation or sends a message.
    openTeamMessages({ kind: 'link', publicRef: card.contact.publicRef })
  }
  // Replace the card rather than stacking two modal focus traps. Cancelling
  // reveals the same card and leaves the underlying conversation/draft intact.
  if (creating) return <TeamMembershipForm key={accountKey} mode="create" accountKey={accountKey}
    onClose={() => setCreating(false)} onChanged={() => { invalidateTeamMessages(accountKey); arkmeContactsTab.invalidateDirectoryCache() }}
    onSelect={selection => {
      arkmeContactsTab.activateAccount(accountKey)
      arkmeContactsTab.setSectionExpanded('teams', true)
      arkmeContactsTab.select(selection)
      onClose(); arkmeUi.showContacts()
    }} />
  return <TeamFeatureDialog title={tr('团队资料')} teamName={card?.name ?? `@${jotmoId}`} className="arkme-team-public-card" onClose={onClose}>
    <style>{`
      .arkme-contact-remark-dialog.arkme-team-public-card { width:min(440px,100%); }
      .arkme-team-public-card .arkme-team-create-link { border:0; border-radius:4px; background:transparent; color:${arkmeTheme.secondary}; padding:6px; font:inherit; font-size:12px; cursor:pointer; }
      .arkme-team-public-card .arkme-team-create-link::after { content:' ↗'; }
      .arkme-team-public-card .arkme-team-create-link:is(:hover,:focus-visible) { color:${arkmeTheme.text}; }
      .arkme-team-public-card .arkme-team-create-link:focus-visible { outline:2px solid ${arkmeTheme.accent}; outline-offset:2px; }
    `}</style>
    <div style={styles.body}>
      {!card && !error && <p role="status">{tr('正在加载团队资料…')}</p>}
      {error && <p role="alert">{error} <button type="button" style={styles.link} onClick={() => setAttempt(value => value + 1)}>{tr('重试')}</button></p>}
      {card && <>
        {card.contact.state!=='unavailable'&&<div style={styles.identity}><ArkmeTeamAvatar name={card.name} avatar={card.avatar} size={56} /><div style={{ minWidth: 0 }}>
          <strong style={{ display: 'block', fontSize: 18, overflowWrap: 'anywhere' }}>{card.name}</strong><span style={styles.hint}>@{card.jotmoId}</span>
        </div></div>}
        {card.description&&<p style={styles.hint}>{card.description}</p>}
        <div style={{ ...styles.contact, gap: 12 }}>
          <button type="button" style={styles.link} onClick={() => { onClose(); arkmeUi.showTeamWorld({ name: card.name, jotmoId: card.jotmoId, avatar: card.avatar }) }}>{tr('团队的世界')}</button>
          {!inCurrentConversation && <button type="button" disabled={card.navigation?.kind!=='inbox'&&(card.contact.state === 'disabled'||card.contact.state==='unavailable')} style={styles.link} onClick={contact}>{tr(card.navigation?.kind==='inbox'?'进入团队收件箱':'联系团队')}</button>}
        </div>
        {card.contact.state === 'unavailable' && <p role="status" style={styles.hint}>{tr('团队资料暂不可用')}</p>}
        {card.contact.state === 'disabled' && <p role="status" style={styles.hint}>{tr('该团队暂未开放消息通道。')}</p>}

      </>}
      {!card && !inCurrentConversation && <div style={styles.contact}><button type="button" disabled>{tr('联系团队')}</button></div>}
      <section aria-label={tr('团队功能介绍')} style={styles.features}>
        <h3 style={{ margin: '0 0 12px', fontSize: 15, fontWeight: 600 }}>{tr('让沟通由整个团队共同处理')}</h3>
        <ul style={styles.featureList}>
          <li>{tr('一个团队入口，对外统一沟通')}</li>
          <li>{tr('同事共同查看、接续回复')}</li>
          <li>{tr('消息与已读状态同步')}</li>
        </ul>
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 12 }}>
          <button type="button" className="arkme-team-create-link" data-arkme-hover="none" onClick={() => setCreating(true)}>{tr('我也要创建团队')}</button>
        </div>
      </section>
    </div>
  </TeamFeatureDialog>
}

const styles: Record<string, CSSProperties> = {
  body: { padding: 20, fontSize: 13 },
  identity: { display: 'flex', alignItems: 'center', gap: 14 },
  hint: { fontSize: 12, lineHeight: 1.7, color: arkmeTheme.secondary },
  link: { border: 0, background: 'transparent', padding: 6, color: arkmeTheme.accent, cursor: 'pointer' },
  contact: { display: 'flex', justifyContent: 'flex-end', paddingTop: 8 },
  features: { borderTop: `1px solid ${arkmeTheme.borderSoft}`, marginTop: 16, paddingTop: 20 },
  featureList: { margin: 0, paddingLeft: 18, color: arkmeTheme.secondary, lineHeight: 2, fontSize: 13 },
  notice: { padding: 12, borderRadius: 10, background: arkmeTheme.subtle, lineHeight: 1.7 },
}
