import { openConfirmedTeamContact } from './team-entry-navigation.js'
import { useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import { CaretDown } from '@phosphor-icons/react/dist/icons/CaretDown'
import type { ArkmeContactSearchResult, ArkmeSourceItem } from '../types.js'
import { callArkme } from './api.js'
import { ArkmeUserAvatar } from './ArkmeAvatar.js'
import { ArkmePeoplePickerSearch } from './ArkmePeoplePickerSearch.js'
import { ArkmeRightPanelHeader } from './ArkmeRightPanelHeader.js'
import { arkmeTheme } from './arkme-theme.js'
import { arkmeConversationMembers } from './conversation-members-store.js'
import { chooseContactTeam, contactTeamError, openTeamContact, rememberContactTeam, teamContactTeams } from './team-contact.js'
import { subscribeTeamOutbound, type TeamOutboundIntent, type TeamOutboundPerson } from './team-outbound.js'
import { loadMoreTeamOutboundContacts, observeTeamOutboundAccount, teamOutboundContacts } from './team-outbound-contacts.js'
import { arkmeChatDirectory } from './chat-directory-store.js'
import { arkmeAuthStore } from './auth-store.js'
import { identityShareAccountScope } from './identity-share-ui.js'
import type { ResourceStore } from './resource-store.js'
import { tr, useArkmeLocale } from './locale.js'

const errorText = (e: unknown) => e instanceof Error ? e.message : tr('加载失败，请重试')
const personKey = (person?: TeamOutboundPerson) => JSON.stringify(person?.recipient)

function usePickerResource<T>(store: ResourceStore<T, string>, account: string, enabled: boolean) {
  const subscribe = useCallback((listener: () => void) => enabled ? store.subscribe(account, account, listener) : () => {}, [store, account, enabled])
  const snapshot = useSyncExternalStore(subscribe, () => enabled ? store.get(account, account) : store.empty)
  const refresh = useCallback(() => { if (enabled) void store.refresh(account, account).catch(() => {}) }, [store, account, enabled])
  useEffect(() => { if (enabled) void store.refresh(account, account, false).catch(() => {}) }, [store, account, enabled])
  // Provider replacement clears opaque references. Active consumers reload the cleared snapshot.
  useEffect(() => {
    if (enabled && snapshot.value === undefined && !snapshot.refreshing && snapshot.error === undefined) refresh()
  }, [enabled, snapshot.value, snapshot.refreshing, snapshot.error, refresh])
  return { snapshot, refresh }
}

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

function PersonRow({ person, selected, disabled, onSelect }: { person: TeamOutboundPerson; selected?: TeamOutboundPerson | undefined; disabled: boolean; onSelect(person: TeamOutboundPerson): void }) {
  const checked = personKey(person) === personKey(selected)
  return <button type="button" role="radio" aria-checked={checked} disabled={disabled} style={{ ...styles.contact, background: checked ? arkmeTheme.hover : 'transparent' }} onClick={() => onSelect(person)} onKeyDown={event => {
    if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
    const rows = [...(event.currentTarget.closest('[role="radiogroup"]')?.querySelectorAll<HTMLButtonElement>('[role="radio"]:not(:disabled)') ?? [])]
    if (!rows.length) return
    event.preventDefault()
    const index = rows.indexOf(event.currentTarget)
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? rows.length - 1 : (index + (['ArrowUp', 'ArrowLeft'].includes(event.key) ? -1 : 1) + rows.length) % rows.length
    rows[next]?.focus(); rows[next]?.click()
  }}>
    <ArkmeUserAvatar avatarRef={person.avatarRef} size={32} label={person.displayName}/><span style={styles.name}>{person.displayName}</span>
    <span aria-hidden style={{ ...styles.radio, borderColor: checked ? arkmeTheme.primaryAction : arkmeTheme.border, background: checked ? arkmeTheme.primaryAction : 'transparent', color: arkmeTheme.onPrimaryAction }}>{checked ? '✓' : ''}</span>
  </button>
}

/** Member references stay bound to the group that issued them. */
function GroupPeople({ accountKey, source, query, selected, disabled, onSelect }: { accountKey: string; source: ArkmeSourceItem; query: string; selected?: TeamOutboundPerson | undefined; disabled: boolean; onSelect(person: TeamOutboundPerson): void }) {
  const subscribe = useCallback((listener: () => void) => arkmeConversationMembers.subscribe(accountKey, source, listener), [accountKey, source])
  const snapshot = useSyncExternalStore(subscribe, () => arkmeConversationMembers.get(accountKey, source))
  const members = snapshot.items.filter(member => !member.isSelf && member.status === 'active' && [member.displayName, member.secondaryName, member.memberName].some(name => name?.toLowerCase().includes(query)))
  return <div style={{ paddingLeft: 16 }} role="radiogroup" aria-label={tr('{v0} 的成员', { v0: source.displayName })}>
    {members.map(member => <PersonRow key={member.memberRef} person={{ recipient: { kind: 'chat-member', sourceRef: source.sourceRef, memberRef: member.memberRef }, displayName: member.displayName, avatarRef: member.avatarRef }} selected={selected} disabled={disabled} onSelect={onSelect}/>)}
    {snapshot.refreshing && <p role="status" style={styles.hint}>{tr('正在加载成员…')}</p>}
    {snapshot.error && <p role="alert" style={styles.error}>{snapshot.error} <button type="button" style={styles.link} onClick={() => { void arkmeConversationMembers.ensure(accountKey, source, true) }}>{tr('重试')}</button></p>}
    {snapshot.complete && !snapshot.error && !members.length && <p style={styles.hint}>{tr('没有找到相关对象')}</p>}
  </div>
}

/** A compact single-person picker. Opening a session never sends a message. */
export function TeamOutboundDialog({ intent, onClose }: { intent: TeamOutboundIntent; onClose(): void }) {
  useArkmeLocale()
  const account = useSyncExternalStore(arkmeAuthStore.subscribe, identityShareAccountScope)
  const enabled = !!account && account === intent.accountKey
  const { snapshot: teamSnapshot, refresh: refreshTeams } = usePickerResource(teamContactTeams, intent.accountKey, enabled)
  const { snapshot: contactSnapshot, refresh: refreshContacts } = usePickerResource(teamOutboundContacts, intent.accountKey, enabled && !intent.person)
  const directory = useSyncExternalStore(arkmeChatDirectory.subscribe, arkmeChatDirectory.getSnapshot)
  const conversations = useSyncExternalStore(arkmeChatDirectory.subscribe, arkmeChatDirectory.getConversationSnapshot)
  const teams = teamSnapshot.value ?? [], [teamId, setTeamId] = useState('')
  const teamLoading = teamSnapshot.value === undefined && !teamSnapshot.error
  const teamError = teamSnapshot.error ? errorText(teamSnapshot.error) : !teamLoading && intent.teamJotmoId && !teams.some(value => value.jotmoId === intent.teamJotmoId) ? tr('你已不在该团队中，请重新进入团队') : ''
  const [person, setPerson] = useState<TeamOutboundPerson | undefined>(intent.person)
  const contacts = contactSnapshot.value?.items ?? [], hasMore = contactSnapshot.value?.hasMore === true
  const contactsLoading = contactSnapshot.refreshing || contactSnapshot.mutating || (contactSnapshot.value === undefined && !contactSnapshot.error)
  const contactsError = contactSnapshot.error || contactSnapshot.operationError ? errorText(contactSnapshot.error ?? contactSnapshot.operationError) : ''
  const groups = conversations.accountScope === intent.accountKey ? conversations.sources.filter(source => source.kind === 'group_chat') : []
  const [groupsReadError, setGroupsReadError] = useState(''), [expanded, setExpanded] = useState('')
  const groupsError = groupsReadError || (conversations.accountScope === intent.accountKey ? directory.projection?.error ?? '' : '')
  const groupsLoading = !groupsError && (conversations.accountScope !== intent.accountKey || !conversations.baselineReady || (directory.projection
    ? directory.projection.phase === 'cached' || directory.projection.phase === 'syncing' : directory.isRefreshing))
  const [query, setQuery] = useState(''), [lookup, setLookup] = useState(false), [lookupError, setLookupError] = useState(''), [found, setFound] = useState<TeamOutboundPerson>()
  const [busy, setBusy] = useState(false), [error, setError] = useState('')
  const requests = useRef(new Set<AbortController>()), lookupRequest = useRef<AbortController>()
  const opening = useRef(false), requestUid = useRef(''), dialog = useRef<HTMLDivElement>(null)
  const mounted = useRef(true)
  const team = chooseContactTeam(teams, intent.accountKey, teamId, intent.teamJotmoId)
  const controller = () => { const c = new AbortController(); requests.current.add(c); return c }
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; for (const c of requests.current) c.abort(); requests.current.clear(); lookupRequest.current = undefined } }, [])
  useEffect(() => {
    if (!intent.person && contactSnapshot.value === undefined) { setPerson(undefined); setFound(undefined); requestUid.current = '' }
  }, [Boolean(intent.person), contactSnapshot.value === undefined])
  useLayoutEffect(() => {
    const previous = document.activeElement
    dialog.current?.focus({ preventScroll: true })
    return () => { if (previous instanceof HTMLElement && previous.isConnected) previous.focus({ preventScroll: true }) }
  }, [])
  const loadGroups = useCallback((force = false) => {
    setGroupsReadError('')
    void arkmeChatDirectory.refreshRoot({ force }).catch(e => {
      if (mounted.current && identityShareAccountScope() === intent.accountKey) setGroupsReadError(errorText(e))
    })
  }, [intent.accountKey])
  useEffect(() => {
    if (!enabled || intent.person) return
    observeTeamOutboundAccount()
    arkmeChatDirectory.activateAccount(intent.accountKey)
    loadGroups()
  }, [enabled, intent.accountKey, Boolean(intent.person), loadGroups])
  useEffect(() => { if (directory.projection?.phase === 'complete') setGroupsReadError('') }, [directory.projection?.revision, directory.projection?.phase])
  const selectPerson = (next: TeamOutboundPerson) => {
    lookupRequest.current?.abort(); lookupRequest.current = undefined; setLookup(false)
    if (personKey(next) !== personKey(person)) requestUid.current = ''
    setPerson(next); setError(''); setLookupError('')
  }
  const changeQuery = (value: string) => {
    lookupRequest.current?.abort(); lookupRequest.current = undefined
    setLookup(false); setLookupError(''); setFound(undefined); setQuery(value)
  }
  const findUser = async () => {
    const identifier = query.trim()
    if (!identifier || lookupRequest.current || busy) return
    const c = controller(); lookupRequest.current = c; setLookup(true); setLookupError('')
    try {
      const result = await callArkme<ArkmeContactSearchResult>('contacts.search', { identifier }, c.signal)
      if (c.signal.aborted) return
      if (result.team) throw new Error(tr('请选择个人用户，不能向另一个团队发起团队私信'))
      if (result.isSelf) throw new Error(tr('请选择其他用户'))
      if (!result.registered || !result.contactRef) throw new Error(tr('未找到已注册用户，请核对即我号或手机号'))
      setFound({ recipient: { kind: 'contact-lookup', contactRef: result.contactRef }, displayName: result.displayName, avatarRef: result.avatarRef })
    } catch (e) { if (!c.signal.aborted) setLookupError(errorText(e)) }
    finally { requests.current.delete(c); if (lookupRequest.current === c) { lookupRequest.current = undefined; setLookup(false) } }
  }
  const open = async () => {
    if (!team || !person || teamLoading || teamError || opening.current) return
    opening.current = true; setBusy(true); setError('')
    const c = controller(); requestUid.current ||= crypto.randomUUID()
    try {
      const conversation = await openTeamContact({ accountKey: intent.accountKey, person }, team, requestUid.current, c.signal)
      if (c.signal.aborted || !mounted.current) return
      if (!openConfirmedTeamContact(intent.accountKey, conversation)) throw new Error(tr('登录账号已变化，请重新打开此窗口'))
      rememberContactTeam(intent.accountKey, team)
      onClose()
    } catch (e) { if (!c.signal.aborted) setError(contactTeamError(e, team)) }
    finally { requests.current.delete(c); opening.current = false; if (!c.signal.aborted && mounted.current) setBusy(false) }
  }
  const search = query.trim().toLowerCase()
  const filtered = contacts.filter(value => [value.displayName, value.nickname, value.remark, value.accountName].some(text => text?.toLowerCase().includes(search)))
  if (!enabled) return null
  return createPortal(<div style={styles.backdrop} data-team-outbound-backdrop onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}>
    <div ref={dialog} tabIndex={-1} role="dialog" aria-modal="true" aria-label={tr('联系用户')} style={styles.dialog} onKeyDown={e => {
      e.stopPropagation()
      if (e.key === 'Escape' && !e.nativeEvent.isComposing) { e.preventDefault(); onClose() }
      if (e.key === 'Tab') {
        const controls = dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled)')
        const first = controls?.[0], last = controls?.[controls.length - 1]
        if (e.shiftKey && (document.activeElement === first || document.activeElement === dialog.current)) { e.preventDefault(); last?.focus() }
        else if (!e.shiftKey && (document.activeElement === last || document.activeElement === dialog.current)) { e.preventDefault(); first?.focus() }
      }
    }}>
      <ArkmeRightPanelHeader title={team ? tr('联系用户 · {team}', { team: team.name }) : tr('联系用户')} onClose={onClose} closeLabel={tr('关闭')}/>
      {teamLoading && <p role="status" style={styles.message}>{tr('正在加载团队…')}</p>}
      {teamError && <p role="alert" style={styles.message}>{teamError} <button type="button" style={styles.link} disabled={busy || teamSnapshot.refreshing} onClick={refreshTeams}>{tr('重试')}</button></p>}
      {!teamLoading && !teamError && !teams.length && <p style={styles.message}>{tr('尚未加入团队')}</p>}
      {!intent.teamJotmoId && teams.length > 1 && <select aria-label={tr('选择团队')} value={team?.jotmoId ?? ''} disabled={busy || teamLoading} style={styles.teamSelect} onChange={e => { setTeamId(e.currentTarget.value); setError(''); requestUid.current = '' }}>{teams.map(value => <option key={value.jotmoId} value={value.jotmoId}>{value.name}</option>)}</select>}
      {!intent.person && <ArkmePeoplePickerSearch value={query} onChange={changeQuery} onSubmit={() => { void findUser() }} disabled={busy} label="查找联系用户" placeholder="搜索联系人 / 即我号 / 手机号"/>}
      <div style={styles.body}>
        {intent.person ? <PersonRow person={intent.person} selected={person} disabled={busy} onSelect={selectPerson}/> : <>
          {search && <button type="button" disabled={lookup || busy} style={styles.searchLookup} onClick={() => { void findUser() }}>{lookup ? tr('查找中…') : tr('查找用户“{query}”', { query: query.trim() })}</button>}
          {lookupError && <p role="alert" style={styles.error}>{lookupError}</p>}
          {found && <div role="radiogroup" aria-label={tr('搜索结果')}><PersonRow person={found} selected={person} disabled={busy} onSelect={selectPerson}/></div>}
          <div style={styles.section}>{tr('联系人')}</div>
          <div role="radiogroup" aria-label={tr('选择联系用户')}>{filtered.map(value => <PersonRow key={value.contactRef} person={{ recipient: { kind: 'directory-contact', contactRef: value.contactRef }, displayName: value.remark || value.displayName, avatarRef: value.avatarRef }} selected={person} disabled={busy} onSelect={selectPerson}/>)}</div>
          {!contactsLoading && !contactsError && !filtered.length && <p style={styles.hint}>{tr('已加载联系人中没有匹配结果')}</p>}
          {contactsLoading && <p role="status" style={styles.hint}>{tr(contacts.length ? '正在更新联系人…' : '正在加载联系人…')}</p>}
          {contactsError && <p role="alert" style={styles.error}>{contactsError}</p>}
          {(hasMore || contactsError) && <button type="button" style={styles.link} disabled={contactsLoading || busy} onClick={() => {
            if (contactSnapshot.error || !contactSnapshot.value) refreshContacts()
            else void loadMoreTeamOutboundContacts(intent.accountKey).catch(() => {})
          }}>{tr(contactsError ? '重试加载联系人' : '加载更多联系人')}</button>}
          <div style={styles.section}>{tr('群聊')}</div>
          {groups.map(group => <div key={group.sourceRef}>
            <button type="button" style={styles.contact} disabled={busy} aria-expanded={expanded === group.sourceRef} onClick={() => setExpanded(old => old === group.sourceRef ? '' : group.sourceRef)}><span style={styles.groupIcon}>#</span><span style={styles.name}>{group.displayName}</span><CaretDown size={16} style={{ transform: expanded === group.sourceRef ? 'rotate(180deg)' : undefined }}/></button>
            {expanded === group.sourceRef && <GroupPeople accountKey={intent.accountKey} source={group} query={search} selected={person} disabled={busy} onSelect={selectPerson}/>}
          </div>)}
          {groupsLoading && <p role="status" style={styles.hint}>{tr(groups.length ? '正在同步群聊…' : '正在加载群聊…')}</p>}
          {groupsError && <p role="alert" style={styles.error}>{groupsError}</p>}
          {groupsError && <button type="button" style={styles.link} disabled={directory.isRefreshing || busy} onClick={() => loadGroups(true)}>{tr('重试加载群聊')}</button>}
          {!groups.length && !groupsLoading && !groupsError && <p style={styles.hint}>{tr('暂无群聊')}</p>}
        </>}
      </div>
      {error && <p role="alert" style={{ ...styles.error, margin: '0 14px 8px' }}>{error}</p>}
      <footer style={styles.footer}>
        <span style={{ ...styles.name, display: 'flex', alignItems: 'center', gap: 8 }}>{person ? <><ArkmeUserAvatar avatarRef={person.avatarRef} size={24} label={person.displayName}/><span style={styles.name}>{person.displayName}</span></> : <span style={styles.hint}>{tr('未选择对象')}</span>}</span>
        <button type="button" disabled={!team || !person || teamLoading || !!teamError || busy} style={{ ...styles.button, opacity: !team || !person || teamLoading || teamError || busy ? .5 : 1 }} onClick={() => { void open() }}>{tr(busy ? '正在打开…' : '发起会话')}</button>
      </footer>
    </div>
  </div>, document.body)
}

const styles: Record<string, CSSProperties> = {
  backdrop: { position: 'fixed', inset: 0, zIndex: 1000, display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', placeItems: 'center', boxSizing: 'border-box', padding: 16, background: 'rgba(0,0,0,.24)' },
  dialog: { width: 360, minWidth: 0, height: 'min(560px, calc(100dvh - 32px))', maxWidth: '100%', display: 'flex', flexDirection: 'column', borderRadius: 14, overflow: 'hidden', background: arkmeTheme.layer1, color: arkmeTheme.text, boxShadow: arkmeTheme.shadow, fontSize: 14, outline: 'none' },
  body: { padding: '8px 12px', overflowY: 'auto', flex: 1, minHeight: 120 },
  teamSelect: { margin: '12px 12px 0', padding: 8, borderRadius: 8, border: `1px solid ${arkmeTheme.border}`, color: 'inherit', background: arkmeTheme.base, font: 'inherit' },
  button: { flexShrink: 0, height: 38, minWidth: 110, padding: '0 14px', border: 0, borderRadius: 11, background: arkmeTheme.primaryAction, color: arkmeTheme.onPrimaryAction, font: 'inherit', cursor: 'pointer' },
  link: { border: 0, background: 'transparent', color: arkmeTheme.accent, padding: 6, cursor: 'pointer' },
  hint: { color: arkmeTheme.secondary, fontSize: 12, lineHeight: 1.6 },
  message: { margin: '12px 14px 0', fontSize: 12, lineHeight: 1.6 },
  name: { flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textAlign: 'left' },
  contact: { display: 'flex', alignItems: 'center', gap: 10, padding: '9px 8px', width: '100%', border: 0, borderRadius: 8, background: 'transparent', color: 'inherit', cursor: 'pointer', font: 'inherit' },
  radio: { display: 'grid', placeItems: 'center', width: 18, height: 18, flexShrink: 0, border: '1px solid', borderRadius: '50%', fontSize: 12 },
  section: { fontSize: 12, fontWeight: 600, padding: '12px 8px 6px', color: arkmeTheme.secondary },
  groupIcon: { width: 32, height: 32, display: 'grid', placeItems: 'center', borderRadius: 8, background: arkmeTheme.base, fontSize: 19, color: arkmeTheme.secondary },
  searchLookup: { width: '100%', border: 0, borderRadius: 8, background: arkmeTheme.base, color: arkmeTheme.accent, padding: 10, textAlign: 'left', cursor: 'pointer' },
  error: { color: arkmeTheme.danger, fontSize: 12, lineHeight: 1.6 },
  footer: { height: 58, flex: 'none', display: 'flex', alignItems: 'center', gap: 10, padding: '0 14px', borderTop: `1px solid ${arkmeTheme.border}`, background: arkmeTheme.layer1 },
}
