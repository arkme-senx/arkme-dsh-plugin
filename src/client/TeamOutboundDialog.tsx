import { openTeamEntryMessages } from './team-entry-navigation.js'
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import { X } from '@phosphor-icons/react/dist/icons/X'
import type { ArkmeContactSearchResult, ArkmeDirectoryItem, ArkmeDirectoryPage, ArkmeTeam } from '../types.js'
import { TEAM_OUTBOUND_PENDING_TEXT, type TeamOutboundOpenResult } from '../team-outbound-contract.js'
import { callArkme } from './api.js'
import { ArkmeUserAvatar } from './ArkmeAvatar.js'
import { ArkmeTeamAvatar } from './ArkmeTeamAvatar.js'
import { arkmeTheme } from './arkme-theme.js'
import { invalidateTeamMessages, openTeamMessages } from './team-messaging-events.js'
import { subscribeTeamOutbound, type TeamOutboundIntent, type TeamOutboundPerson } from './team-outbound.js'
import { tr, useArkmeLocale } from './locale.js'

type Contact = Extract<ArkmeDirectoryItem, { kind: 'contact' }>
const errorText = (e: unknown) => e instanceof Error ? e.message : tr('加载失败，请重试')

export function TeamOutboundMount({ accountKey, active }: { accountKey: string; active: boolean }) {
  const [request, setRequest] = useState<{ intent: TeamOutboundIntent; revision: number }>()
  const sequence = useRef(0)
  const close = useCallback(() => setRequest(undefined), [])
  useEffect(() => {
    setRequest(undefined)
    if (!active) return
    return subscribeTeamOutbound(intent => {
      if (intent.accountKey === accountKey) setRequest({ intent, revision: ++sequence.current })
    })
  }, [accountKey, active])
  return active && request?.intent.accountKey === accountKey
    ? <TeamOutboundDialog key={`${accountKey}:${request.revision}`} intent={request.intent} onClose={close} /> : null
}

/** No personal-chat creation or message sending takes place in this dialog. */
export function TeamOutboundDialog({ intent, onClose }: { intent: TeamOutboundIntent; onClose(): void }) {
  useArkmeLocale()
  const [teams, setTeams] = useState<ArkmeTeam[]>([]), [teamId, setTeamId] = useState(intent.teamJotmoId ?? '')
  const [teamLoading, setTeamLoading] = useState(true), [teamError, setTeamError] = useState(''), [attempt, setAttempt] = useState(0)
  const [person, setPerson] = useState<TeamOutboundPerson | undefined>(intent.person)
  const [contacts, setContacts] = useState<Contact[]>([]), [cursor, setCursor] = useState<string>()
  const [hasMore, setHasMore] = useState(false), [contactsLoading, setContactsLoading] = useState(false), [contactsError, setContactsError] = useState('')
  const [query, setQuery] = useState(''), [lookup, setLookup] = useState(false), [lookupError, setLookupError] = useState('')
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [pending, setPending] = useState(false)
  const requests = useRef(new Set<AbortController>()), contactRequest = useRef<AbortController>(), lookupRequest = useRef<AbortController>()
  const opening = useRef(false), requestUid = useRef(''), dialog = useRef<HTMLDivElement>(null)
  const mounted = useRef(true)
  const team = teams.find(value => value.jotmoId === teamId)
  const controller = () => { const c = new AbortController(); requests.current.add(c); return c }
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; for (const c of requests.current) c.abort(); requests.current.clear(); contactRequest.current = undefined; lookupRequest.current = undefined } }, [])
  useLayoutEffect(() => {
    const previous = document.activeElement
    dialog.current?.focus({ preventScroll: true })
    return () => { if (previous instanceof HTMLElement && previous.isConnected) previous.focus({ preventScroll: true }) }
  }, [])
  useEffect(() => {
    const c = controller()
    setTeamLoading(true); setTeamError('')
    void callArkme<ArkmeTeam[]>('team.app.teams', { expectedAccountKey: intent.accountKey }, c.signal).then(values => {
      if (c.signal.aborted) return
      setTeams(values)
      setTeamId(old => values.some(value => value.jotmoId === old) ? old : intent.teamJotmoId ? values.find(value => value.jotmoId === intent.teamJotmoId)?.jotmoId ?? '' : values.length === 1 ? values[0]!.jotmoId : '')
      if (intent.teamJotmoId && !values.some(value => value.jotmoId === intent.teamJotmoId)) setTeamError(tr('你已不在该团队中，请重新选择团队'))
    }).catch(e => { if (!c.signal.aborted) { setTeams([]); setTeamError(errorText(e)) } })
      .finally(() => { requests.current.delete(c); if (!c.signal.aborted) setTeamLoading(false) })
    return () => c.abort()
  }, [intent.accountKey, intent.teamJotmoId, attempt])

  const loadContacts = async (next?: string) => {
    if (contactRequest.current) return
    const c = controller(); contactRequest.current = c
    setContactsLoading(true); setContactsError('')
    try {
      const page = await callArkme<ArkmeDirectoryPage>('directory.list', { section: 'contacts', limit: 50, ...(next ? { cursor: next } : {}) }, c.signal)
      if (c.signal.aborted) return
      if (page.hasMore && (!page.nextCursor || page.nextCursor === next)) throw new Error(tr('联系人分页异常，请重试'))
      setContacts(old => [...new Map([...(next ? old : []), ...page.items.filter((v): v is Contact => v.kind === 'contact')].map(v => [v.contactRef, v])).values()])
      setCursor(page.nextCursor); setHasMore(page.hasMore)
    } catch (e) { if (!c.signal.aborted) setContactsError(errorText(e)) }
    finally { requests.current.delete(c); if (contactRequest.current === c) contactRequest.current = undefined; if (!c.signal.aborted) setContactsLoading(false) }
  }
  useEffect(() => { if (!intent.person) void loadContacts() }, [])
  const selectPerson = (next: TeamOutboundPerson) => {
    lookupRequest.current?.abort(); lookupRequest.current = undefined; setLookup(false)
    setPerson(next); setPending(false); setError(''); setLookupError(''); requestUid.current = ''
  }
  const findUser = async () => {
    const identifier = query.trim()
    if (!identifier || lookupRequest.current) return
    const c = controller(); lookupRequest.current = c
    setLookup(true); setLookupError('')
    try {
      const found = await callArkme<ArkmeContactSearchResult>('contacts.search', { identifier }, c.signal)
      if (c.signal.aborted) return
      if (found.team) throw new Error(tr('请选择个人用户，不能向另一个团队发起团队私信'))
      if (found.isSelf) throw new Error(tr('请选择其他用户'))
      if (!found.registered || !found.contactRef) throw new Error(tr('未找到已注册用户，请核对即我号或手机号'))
      selectPerson({ recipient: { kind: 'contact-lookup', contactRef: found.contactRef }, displayName: found.displayName, avatarRef: found.avatarRef })
    } catch (e) { if (!c.signal.aborted) setLookupError(errorText(e)) }
    finally { requests.current.delete(c); if (lookupRequest.current === c) { lookupRequest.current = undefined; setLookup(false) } }
  }
  const open = async () => {
    if (!team || !person || teamLoading || !!teamError || opening.current) return
    opening.current = true; setBusy(true); setError(''); setPending(false)
    const c = controller()
    requestUid.current ||= crypto.randomUUID()
    try {
      const result = await callArkme<TeamOutboundOpenResult>('team.app.outbound.open', {
        expectedAccountKey: intent.accountKey, teamRef: team.teamRef, recipient: person.recipient, requestUid: requestUid.current,
      }, c.signal)
      if (c.signal.aborted || !mounted.current) return
      if (result.state === 'backend_pending') { setPending(true); return }
      if (result.state !== 'ready' || !result.conversation?.ref || result.conversation.side !== 'team'
        || result.conversation.channel.jotmoId !== team.jotmoId) throw new Error(tr('团队会话返回异常，请重试'))
      invalidateTeamMessages(intent.accountKey)
      onClose()
      openTeamEntryMessages({ kind: 'conversation', conversation: result.conversation })
    } catch (e) { if (!c.signal.aborted) setError(errorText(e)) }
    finally { requests.current.delete(c); opening.current = false; if (!c.signal.aborted && mounted.current) setBusy(false) }
  }
  const filtered = contacts.filter(value => [value.displayName, value.nickname, value.remark, value.accountName].some(text => text?.toLowerCase().includes(query.trim().toLowerCase())))
  return createPortal(<div style={styles.backdrop} data-team-outbound-backdrop onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}>
    <div ref={dialog} tabIndex={-1} role="dialog" aria-modal="true" aria-label={tr('以团队联系')} style={styles.dialog} onKeyDown={e => {
      e.stopPropagation()
      if (e.key === 'Escape' && !e.nativeEvent.isComposing) { e.preventDefault(); onClose() }
      if (e.key === 'Tab') {
        const controls = dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled)')
        const first = controls?.[0], last = controls?.[controls.length - 1]
        if (e.shiftKey && (document.activeElement === first || document.activeElement === dialog.current)) { e.preventDefault(); last?.focus() }
        else if (!e.shiftKey && (document.activeElement === last || document.activeElement === dialog.current)) { e.preventDefault(); first?.focus() }
      }
    }}>
      <header style={styles.header}><strong>{tr('以团队联系')}</strong><button type="button" style={styles.icon} aria-label={tr('关闭以团队联系')} onClick={onClose}><X size={20} /></button></header>
      <div style={styles.body}>
        <label style={styles.label}>{tr('发送身份')}</label>
        {teamLoading ? <p role="status">{tr('正在加载团队…')}</p> : <>
          <div style={styles.row}>{team && <ArkmeTeamAvatar name={team.name} avatar={team.avatar} size={30} />}
            <select aria-label={tr('选择团队')} value={teamId} disabled={busy || teams.length === 0} style={styles.input} onChange={e => { setTeamId(e.currentTarget.value); setTeamError(''); setPending(false); setError(''); requestUid.current = '' }}>
              <option value="">{tr(teams.length ? '选择团队' : '尚未加入团队')}</option>
              {teams.map(value => <option key={value.jotmoId} value={value.jotmoId}>{value.name} · @{value.jotmoId}</option>)}
            </select></div>
          {!teams.length && !teamError && <p style={styles.hint}>{tr('加入团队后，可在这里代表团队联系用户。')}</p>}
        </>}
        {teamError && <p role="alert" style={styles.error}>{teamError} <button style={styles.link} disabled={busy || teamLoading} onClick={() => setAttempt(v => v + 1)}>{tr('重试')}</button></p>}
        <label style={{ ...styles.label, marginTop: 18 }}>{tr('联系用户')}</label>
        {person ? <div style={styles.person}>
          <ArkmeUserAvatar avatarRef={person.avatarRef} size={36} label={person.displayName} />
          <strong style={styles.name}>{person.displayName}</strong>
          <button type="button" style={styles.link} disabled={busy} onClick={() => { setPerson(undefined); setPending(false); setError(''); setQuery(''); requestUid.current = ''; if (!contacts.length) void loadContacts() }}>{tr('更换')}</button>
        </div> : <>
          <form style={styles.row} onSubmit={e => { e.preventDefault(); void findUser() }}>
            <input aria-label={tr('查找联系用户')} placeholder={tr('联系人名称 / 即我号 / 手机号')} style={styles.input} value={query} onChange={e => { lookupRequest.current?.abort(); lookupRequest.current = undefined; setLookup(false); setLookupError(''); setQuery(e.currentTarget.value) }} />
            <button type="submit" style={styles.button} disabled={!query.trim() || lookup}>{tr(lookup ? '查找中…' : '精确查找')}</button>
          </form>
          <p style={styles.hint}>{tr('名称筛选已加载联系人；即我号或手机号可精确查找。')}</p>
          {lookupError && <p role="alert" style={styles.error}>{lookupError}</p>}
          <div aria-label={tr('选择联系用户')} style={styles.contacts}>{filtered.map(value => <button type="button" style={styles.contact} key={value.contactRef} onClick={() => selectPerson({ recipient: { kind: 'directory-contact', contactRef: value.contactRef }, displayName: value.remark || value.displayName, avatarRef: value.avatarRef })}>
            <ArkmeUserAvatar avatarRef={value.avatarRef} {...(value.avatarFallback ? { fallback: value.avatarFallback } : {})} size={32} label={value.displayName} /><span style={styles.name}>{value.remark || value.displayName}</span>
            {value.accountName && <small style={styles.hint}>@{value.accountName}</small>}
          </button>)}</div>
          {!contactsLoading && !contactsError && !filtered.length && <p style={styles.hint}>{tr('已加载联系人中没有匹配结果')}</p>}
          {contactsLoading && <p role="status" style={styles.hint}>{tr('正在加载联系人…')}</p>}
          {contactsError && <p role="alert" style={styles.error}>{contactsError}</p>}
          {(hasMore || contactsError) && <button style={styles.link} disabled={contactsLoading} onClick={() => { void loadContacts(cursor) }}>{tr(contactsError ? '重试加载联系人' : '加载更多联系人')}</button>}
        </>}
        <p style={styles.notice}>{team && person ? tr('以 {v0} 身份发给 {v1}', { v0: team.name, v1: person.displayName }) : tr('选择团队和用户，开始团队私信')}<br /><span style={styles.hint}>{tr('本团队有权限的成员可共同查看和回复；个人私聊历史不会自动共享。')}</span></p>
        {pending && <div role="status" style={styles.notice}><strong>{tr(TEAM_OUTBOUND_PENDING_TEXT)}</strong><p style={{ ...styles.hint, marginBottom: 0 }}>{tr('已保留当前选择，尚未创建会话或发送消息。')}</p></div>}
        {error && <p role="alert" style={styles.error}>{error}</p>}
      </div>
      <footer style={styles.footer}><button type="button" style={styles.button} onClick={onClose}>{tr('关闭')}</button><button type="button" disabled={!team || !person || teamLoading || !!teamError || busy || pending} style={{ ...styles.button, background: arkmeTheme.primaryAction, color: arkmeTheme.onPrimaryAction, opacity: !team || !person || busy || pending ? .5 : 1 }} onClick={() => { void open() }}>{tr(busy ? '正在打开…' : '开始团队私信')}</button></footer>
    </div>
  </div>, document.body)
}

const styles: Record<string, CSSProperties> = {
  backdrop: { position: 'fixed', inset: 0, zIndex: 1000, display: 'grid', placeItems: 'center', padding: 16, background: 'rgba(0,0,0,.28)' },
  dialog: { width: 460, maxWidth: '100%', maxHeight: 'calc(100dvh - 32px)', display: 'flex', flexDirection: 'column', borderRadius: 14, overflow: 'hidden', background: arkmeTheme.base, color: arkmeTheme.text, boxShadow: arkmeTheme.shadow, fontSize: 14 },
  header: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 20px', borderBottom: `1px solid ${arkmeTheme.borderSoft}` },
  icon: { border: 0, padding: 6, display: 'grid', placeItems: 'center', background: 'transparent', color: arkmeTheme.secondary, cursor: 'pointer' },
  body: { padding: '16px 20px', overflowY: 'auto', minHeight: 0 },
  label: { display: 'block', fontSize: 12, color: arkmeTheme.secondary, marginBottom: 8 },
  row: { display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 },
  input: { flex: 1, minWidth: 0, width: '100%', height: 40, boxSizing: 'border-box', border: `1px solid ${arkmeTheme.border}`, borderRadius: 8, padding: '0 10px', color: 'inherit', background: arkmeTheme.base, font: 'inherit' },
  button: { flexShrink: 0, padding: '10px 14px', border: `1px solid ${arkmeTheme.border}`, borderRadius: 8, background: arkmeTheme.base, color: 'inherit', font: 'inherit', cursor: 'pointer' },
  link: { border: 0, background: 'transparent', color: arkmeTheme.accent, padding: 6, cursor: 'pointer', flexShrink: 0 },
  hint: { color: arkmeTheme.secondary, fontSize: 12, lineHeight: 1.6 },
  name: { flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textAlign: 'left' },
  person: { display: 'flex', alignItems: 'center', gap: 10, borderRadius: 8, padding: 10, background: arkmeTheme.subtle },
  contacts: { maxHeight: 220, overflowY: 'auto' },
  contact: { display: 'flex', alignItems: 'center', gap: 10, padding: '9px 6px', width: '100%', border: 0, borderRadius: 8, background: 'transparent', color: 'inherit', cursor: 'pointer' },
  notice: { background: arkmeTheme.subtle, padding: 12, borderRadius: 8, lineHeight: 1.7, margin: '16px 0 0' },
  error: { color: arkmeTheme.danger, fontSize: 13, lineHeight: 1.6 },
  footer: { display: 'flex', justifyContent: 'flex-end', gap: 10, padding: '12px 20px', borderTop: `1px solid ${arkmeTheme.borderSoft}` },
}
