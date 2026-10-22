import {ArkmeTeamAvatar} from '../../ArkmeTeamAvatar.js'
import {TeamProfileEditor} from './TeamProfileEditor.js'
import type {ArkmeTeamProfile} from '../../../team-profile-contract.js'
import { ChatCircle } from '@phosphor-icons/react/dist/icons/ChatCircle'
import { PencilSimple } from '@phosphor-icons/react/dist/icons/PencilSimple'
import { arkmeContactsTab } from './contacts-tab-store.js'
import { discardTeamDirectory, readTeamDirectory } from '../../team-conversation-directory.js'
import type { TeamMembers } from '../../../team-app-contract.js'
import { TeamMessageChannelDialog } from './TeamMessageChannelDialog.js'
import { openTeamMessages, invalidateTeamMessages, subscribeTeamMessageChanges } from '../../team-messaging-events.js'
import { useArkmeLocale } from '../../locale.js'
import { teamText as tr } from '../../team-messaging-i18n.js'
import { useCallback, useEffect, useRef, useState } from 'react'

import { appTeamReference, codexTeamContext } from './team-reference-navigation.js'
import type { ArkmeTeam, ArkmeTeamMember, ArkmeTeamRole } from '../../../types.js'
import { callArkme } from '../../api.js'
import { ArkmeUserAvatar } from '../../ArkmeAvatar.js'
import { TeamCodexSyncDialog } from './TeamCodexSyncDialog.js'
import { arkmeUi } from '../../ui-controller.js'

interface TeamDetailState {
  status: 'loading' | 'ready' | 'error'
  page?: TeamMembers
  message?: string
  loadingMore?: boolean
}

const ROLE_LABELS: Record<ArkmeTeamRole, string> = {
  owner: '所有者',
  admin: '管理员',
  member: '成员',
}

function loadErrorMessage(error: unknown): string {
  return error instanceof Error && error.message.trim() !== '' ? error.message : '团队成员加载失败'
}

function memberIdentity(member: ArkmeTeamMember): string {
  return member.identityState === 'unavailable'
    ? '身份信息暂不可用'
    : member.identityState === 'incomplete'
      ? '身份信息不完整'
      : member.jotmoId === undefined ? '即我号暂不可用' : `@${member.jotmoId}`
}

export function TeamDetailPane({ accountKey, teamRef, initialView = 'members' }: { accountKey: string; teamRef: string; initialView?: 'members' | 'activity' }) {
  // Keep pagination and the sync dialog scoped to one signed-in account and team.
  return <ScopedTeamDetailPane key={`${accountKey}:${teamRef}`} accountKey={accountKey} teamRef={teamRef} initialView={initialView} />
}

function ScopedTeamDetailPane({ accountKey, teamRef, initialView }: { accountKey: string; teamRef: string; initialView: 'members' | 'activity' }) {
  useArkmeLocale()
  const [state, setState] = useState<TeamDetailState>({ status: 'loading' })
  const [editing,setEditing]=useState<ArkmeTeamProfile>()
  const [profileBusy,setProfileBusy]=useState(false)
  const [syncTeam, setSyncTeam] = useState<ArkmeTeam>()
  const [messageChannelOpen, setMessageChannelOpen] = useState(false)
  const [codexBusy, setCodexBusy] = useState(false)
  const navigationRef = useRef<AbortController>()
  useEffect(() => () => navigationRef.current?.abort(), [])
  const [removing, setRemoving] = useState('')
  const [confirmLeave, setConfirmLeave] = useState(false)
  const [confirmRemoval, setConfirmRemoval] = useState<{ userRef: string; name: string }>()
  const generationRef = useRef(0)
  const controllerRef = useRef<AbortController>()
  const avatarRequests = useRef(new Map<string, AbortController>())

  const hydrateAvatars = useCallback(async (appRef: string, pageCursor?: string) => {
    const key = pageCursor ?? 'first'
    avatarRequests.current.get(key)?.abort()
    const controller = new AbortController()
    avatarRequests.current.set(key, controller)
    try {
      // Retry only optional decoration, never reset/reorder the member list.
      for (const delay of [0, 6_000, 15_000]) {
        if (delay) await new Promise<void>(resolve => {
          const done = () => { clearTimeout(timer); controller.signal.removeEventListener('abort', done); resolve() }
          const timer = setTimeout(done, delay)
          controller.signal.addEventListener('abort', done, { once: true })
        })
        if (controller.signal.aborted) return
        try {
          const enriched = await callArkme<TeamMembers>('team.app.members', {
            teamRef: appRef, limit: 50, avatarMode: 'wait',
            ...(pageCursor === undefined ? {} : { pageCursor }),
          }, controller.signal)
          if (controller.signal.aborted) return
          const byKey = new Map(enriched.items.map(member => [member.key, member]))
          setState(current => {
            if (!current.page) return current
            return { ...current, page: { ...current.page, items: current.page.items.map(member => {
              const fresh = byKey.get(member.key)
              if (!fresh || (enriched.avatarState !== 'ready' && !fresh.avatarRef && !fresh.avatarFallback)) return member
              const { avatarRef: _oldRef, avatarFallback: _oldFallback, ...rest } = member
              return { ...rest,
                ...(fresh.avatarRef === undefined ? {} : { avatarRef: fresh.avatarRef }),
                ...(fresh.avatarFallback === undefined ? {} : { avatarFallback: fresh.avatarFallback }),
              }
            }) } }
          })
          if (enriched.avatarState !== 'unavailable') return
        } catch { if (controller.signal.aborted) return }
      }
    } finally {
      if (avatarRequests.current.get(key) === controller) avatarRequests.current.delete(key)
    }
  }, [])

  const load = useCallback(async (pageCursor?: string, preserveView = false) => {
    if (pageCursor === undefined) {
      for (const request of avatarRequests.current.values()) request.abort()
      avatarRequests.current.clear()
    }
    controllerRef.current?.abort()
    const controller = new AbortController()
    controllerRef.current = controller
    const generation = ++generationRef.current
    setState(current => {
      if (pageCursor === undefined) {
        if (preserveView && current.status === 'ready') return current
        return { status: 'loading' }
      }
      const { message: _message, ...withoutMessage } = current
      return { ...withoutMessage, loadingMore: true }
    })
    try {
      const appRef = await appTeamReference(teamRef, controller.signal)
      const page = await callArkme<TeamMembers>('team.app.members', {
        teamRef: appRef,
        limit: 50,
        avatarMode: 'deferred',
        ...(pageCursor === undefined ? {} : { pageCursor }),
      }, controller.signal)
      if (controller.signal.aborted || generationRef.current !== generation) return
      page.team.teamRef = appRef
      setState(current => {
        // A refresh with pending decoration must not erase already visible photos.
        if (page.avatarState === 'pending' || page.avatarState === 'unavailable') {
          const previous = new Map(current.page?.items.map(member => [member.key, member]))
          page.items = page.items.map(member => {
            const known = previous.get(member.key)
            if (member.avatarRef || member.avatarFallback || !known) return member
            return { ...member,
              ...(known.avatarRef === undefined ? {} : { avatarRef: known.avatarRef }),
              ...(known.avatarFallback === undefined ? {} : { avatarFallback: known.avatarFallback }),
            }
          })
        }
        if (pageCursor === undefined || current.page === undefined) return { status: 'ready', page }
        const members = new Map(current.page.items.map(member => [member.key, member]))
        for (const member of page.items) members.set(member.key, member)
        return { status: 'ready', page: { ...page, items: [...members.values()] } }
      })
      if (page.avatarState === 'pending' || page.avatarState === 'unavailable') void hydrateAvatars(appRef, pageCursor)
    } catch (error) {
      if (controller.signal.aborted || generationRef.current !== generation) return
      const message = loadErrorMessage(error)
      setState(current => pageCursor === undefined
        ? { status: 'error', message }
        : { ...current, status: 'ready', loadingMore: false, message })
    }
  }, [accountKey, teamRef, hydrateAvatars])

  useEffect(() => {
    setConfirmRemoval(undefined); setConfirmLeave(false); setRemoving('')
    void load()
    return () => {
      generationRef.current += 1
      controllerRef.current?.abort()
      for (const request of avatarRequests.current.values()) request.abort()
      avatarRequests.current.clear()
    }
  }, [load])

  useEffect(()=>subscribeTeamMessageChanges((account,receiptOnly)=>{if(account===accountKey&&!receiptOnly)void load(undefined,true)}),[accountKey,load])
  const openProfile=async()=>{
    if(profileBusy||!state.page?.team.canEditProfile)return
    const controller=new AbortController();navigationRef.current?.abort();navigationRef.current=controller;setProfileBusy(true)
    try{const profile=await callArkme<ArkmeTeamProfile>('team.app.profile.get',{teamRef:state.page.team.teamRef},controller.signal);if(!controller.signal.aborted&&profile.canEditProfile)setEditing(profile)}
    catch(e){if(!controller.signal.aborted)setState(current=>({...current,message:loadErrorMessage(e)}))}
    finally{if(!controller.signal.aborted)setProfileBusy(false)}
  }
  const openCodex = async (member?: ArkmeTeamMember) => {
    if (!state.page) return
    navigationRef.current?.abort()
    const request = new AbortController(); navigationRef.current = request
    setCodexBusy(true)
    try {
      const target = await codexTeamContext(state.page.team, member, request.signal)
      if (member) arkmeUi.showCodex({ accountKey, team: target.team, member: target.member!, memberName: member.displayName, fromTeam: true, returnView: 'members' })
      else setSyncTeam(target.team)
    } catch (error) {
      if (!request.signal.aborted) setState(current => ({ ...current, message: loadErrorMessage(error) }))
    } finally { if (!request.signal.aborted) setCodexBusy(false) }
  }
  useEffect(() => {
    if (initialView === 'activity' && state.page) void openCodex()
  }, [initialView, !!state.page])

  const removeMember = async () => {
    if (!confirmRemoval || removing) return
    const member = confirmRemoval, controller = controllerRef.current
    setRemoving(member.userRef)
    try {
      await callArkme('team.app.member.remove', { userRef: member.userRef }, controller?.signal)
      if (controller?.signal.aborted) return
      setConfirmRemoval(undefined); setRemoving(''); await load()
    } catch (error) {
      if (!controller?.signal.aborted) setState(current => ({ ...current, message: loadErrorMessage(error) }))
    } finally { if (!controller?.signal.aborted) setRemoving('') }
  }

  const leaveTeam = async () => {
    if (removing) return
    const controller = controllerRef.current
    setRemoving('leave')
    try {
      await callArkme('team.app.leave', { teamRef: state.page!.team.teamRef }, controller?.signal)
      if (controller?.signal.aborted) return
      const conversation = readTeamDirectory(accountKey).items.find(c => c.side === 'team' && c.channel.jotmoId === state.page!.team.jotmoId)
      if (conversation) discardTeamDirectory(accountKey, conversation)
      arkmeContactsTab.invalidateDirectoryCache()
      arkmeContactsTab.clear()
      invalidateTeamMessages(accountKey)
    } catch (error) {
      if (!controller?.signal.aborted) setState(current => ({ ...current, message: loadErrorMessage(error) }))
    } finally { if (!controller?.signal.aborted) setRemoving('') }
  }

  if (state.status === 'loading') {
    return <div className="arkme-team-detail-status" role="status">{tr("正在加载团队成员…")}</div>
  }
  if (state.status === 'error' || state.page === undefined) {
    return <div className="arkme-team-detail-status is-error" role="alert">
      <span>{state.message ?? '团队成员加载失败'}</span>
      <button type="button" onClick={() => { void load() }}>{tr("重试")}</button>
    </div>
  }

  const { page } = state
  return <section className="arkme-team-detail" data-team-ref={page.team.teamRef}>
    <header className="arkme-team-detail-header">
      <div className="arkme-team-detail-header-main">
        <span className="arkme-team-detail-glyph" aria-hidden><ArkmeTeamAvatar avatar={page.team.avatar} name={page.team.name} size={72}/></span>
        <div className="arkme-team-detail-summary">
          <div className="arkme-team-detail-title-row">
            <h1>{page.team.name}</h1>
            {page.team.canEditProfile === true && <button type="button" className="arkme-team-profile-entry" aria-label="编辑团队" title="编辑团队" disabled={profileBusy} onClick={() => { void openProfile() }}>
              <PencilSimple size={16} aria-hidden />
            </button>}
          </div>
          <div className="arkme-team-detail-meta">
            <span className="arkme-team-detail-public-id">@{page.team.jotmoId}</span>
            <span className="arkme-team-role-badge" data-team-role={page.team.currentUserRole}>
              {ROLE_LABELS[page.team.currentUserRole]}
            </span>
          </div>
        </div>
        <span className="arkme-team-detail-count" aria-label={tr("{v0} 位成员", { v0: page.totalCount })}>
          <strong>{page.totalCount}</strong>
          <span>{tr("位成员")}</span>
        </span>
      </div>
    </header>
    <section className="arkme-team-features" aria-label={tr('团队功能')}>
      <div className="arkme-team-features-container">
        <h2>{tr('团队功能')}</h2>
        <div className="arkme-team-feature-list">
          <button type="button" className="arkme-team-feature" aria-haspopup="dialog" aria-expanded={!!syncTeam} disabled={codexBusy} onClick={() => { void openCodex() }}>
            <span className="arkme-team-feature-icon" aria-hidden="true">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="4" width="18" height="16" rx="4" />
                <path d="m9 9-3 3 3 3m6-6 3 3-3 3" />
              </svg>
            </span>
            <span>{tr('Codex 同步')}</span>
            <span className="arkme-team-feature-arrow" aria-hidden="true">›</span>
          </button>
          <button type="button" className="arkme-team-feature" aria-haspopup="dialog" aria-expanded={messageChannelOpen} onClick={() => setMessageChannelOpen(true)}>
            <span className="arkme-team-feature-icon" aria-hidden="true"><ChatCircle size={22} /></span>
            <span>{tr('团队消息通道')}</span>
            <span className="arkme-team-feature-arrow" aria-hidden="true">›</span>
          </button>
        </div>
      </div>
    </section>
    <section className="arkme-team-members" aria-label={tr("{v0}的成员", { v0: page.team.name })}>
      <div className="arkme-team-members-container">
        <h2>{tr("团队成员")}</h2>
        <div className="arkme-team-member-list" role="list">
          {confirmRemoval && <div className="team-confirm" role="alert"><p>{tr('确认移除 {v0}？', { v0: confirmRemoval.name })}</p>
            <button disabled={!!removing} onClick={() => { void removeMember() }}>{tr('确认')}</button><button disabled={!!removing} onClick={() => { setConfirmRemoval(undefined) }}>{tr('取消')}</button></div>}
          {page.items.map(member => <div className="arkme-team-member-row" role="listitem" key={member.key}>
            <span className="arkme-team-member-avatar">
              <ArkmeUserAvatar
                {...(member.avatarRef === undefined ? {} : { avatarRef: member.avatarRef })}
                {...(member.avatarFallback === undefined ? {} : { fallback: member.avatarFallback })}
                size={40}
                label={tr("{v0}的头像", { v0: member.displayName })}
              />
            </span>
            <span className="arkme-team-member-copy">
              <strong>{member.displayName}</strong>
              <small>{memberIdentity(member)}</small>
            </span>
            <span className="arkme-team-member-actions"><span className="arkme-team-member-role" data-team-member-role={member.role}>
              {ROLE_LABELS[member.role]}
            </span>
            <button type="button" className="arkme-team-member-conversations"
              aria-label={tr('查看 {name} 的 Codex 对话',{name:member.displayName})}
              disabled={codexBusy || !member.jotmoId} onClick={() => { void openCodex(member) }}>
              {tr('查看对话')} <span aria-hidden>›</span>
            </button>
            {member.canRemove && <button type="button" className="arkme-team-action" disabled={!!removing} onClick={() => { setConfirmRemoval({ userRef: member.userRef, name: member.displayName }) }}>{tr('移除')}</button>}</span>
          </div>)}
          {state.message !== undefined && <div className="arkme-team-member-more-error" role="alert">{state.message}</div>}
          {page.hasMore && page.nextPageCursor !== undefined && <button
            type="button"
            className="arkme-team-member-more"
            disabled={state.loadingMore === true}
            onClick={() => { void load(page.nextPageCursor) }}
          >{state.loadingMore === true ? tr("加载中…") : tr('加载更多成员')}</button>}
        </div>
      </div>
    </section>
    {editing&&<TeamProfileEditor profile={editing} onClose={()=>setEditing(undefined)} onUpdated={profile=>{
      setEditing(undefined);if(profile)setState(current=>current.page?{...current,page:{...current.page,team:{...current.page.team,name:profile.name,profileRevision:profile.profileRevision,canEditProfile:profile.canEditProfile,avatar:profile.avatar}}}:current)
      arkmeContactsTab.invalidateDirectoryCache();invalidateTeamMessages(accountKey)
    }}/>}
    {syncTeam && <TeamCodexSyncDialog team={syncTeam} onClose={() => setSyncTeam(undefined)} onViewConversations={() => {
      setSyncTeam(undefined)
      arkmeUi.showCodex({ accountKey, team: syncTeam, member: '', fromTeam: true, returnView: 'activity' })
    }} />}
    {messageChannelOpen && <TeamMessageChannelDialog accountKey={accountKey} teamRef={page.team.teamRef} teamName={page.team.name}
      onClose={() => setMessageChannelOpen(false)} onChanged={() => { void load(undefined, true) }}
      onViewConversations={() => { setMessageChannelOpen(false); openTeamMessages({kind:'team',teamRef:page.team.teamRef}) }} />}

    {page.team.currentUserRole !== 'owner' && <div className="arkme-team-detail-footer">
      {confirmLeave ? <div className="team-confirm" role="alert">
        <p>{tr('退出后将无法查看或回复团队对话。确认退出？')}</p>
        <button disabled={!!removing} onClick={() => { void leaveTeam() }}>{tr('确认退出')}</button>
        <button disabled={!!removing} onClick={() => { setConfirmLeave(false) }}>{tr('取消')}</button>
      </div> : <button disabled={!!removing} onClick={() => { setConfirmLeave(true) }}>{tr('退出团队')}</button>}
    </div>}
  </section>
}
