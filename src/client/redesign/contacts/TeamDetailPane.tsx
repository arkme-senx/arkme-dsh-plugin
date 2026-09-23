import { arkmeContactsTab } from './contacts-tab-store.js'
import { discardTeamDirectory, readTeamDirectory } from '../../team-conversation-directory.js'
import type { TeamMembers } from '../../../team-app-contract.js'
import { TeamChannelSettings } from '../../TeamMessagingPanel.js'
import { openTeamMessages, invalidateTeamMessages } from '../../team-messaging-events.js'
import { useArkmeLocale } from '../../locale.js'
import { teamText as tr } from '../../team-messaging-i18n.js'
import { useCallback, useEffect, useRef, useState } from 'react'

import type { ArkmeTeamMember, ArkmeTeamRole } from '../../../types.js'
import { callArkme } from '../../api.js'
import { ArkmeUserAvatar } from '../../ArkmeAvatar.js'

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

export function TeamDetailPane({ accountKey, teamRef }: { accountKey: string; teamRef: string }) {
  useArkmeLocale()
  const [state, setState] = useState<TeamDetailState>({ status: 'loading' })
  const [removing, setRemoving] = useState('')
  const [confirmLeave, setConfirmLeave] = useState(false)
  const [confirmRemoval, setConfirmRemoval] = useState<{ userRef: string; name: string }>()
  const generationRef = useRef(0)
  const controllerRef = useRef<AbortController>()

  const load = useCallback(async (pageCursor?: string) => {
    controllerRef.current?.abort()
    const controller = new AbortController()
    controllerRef.current = controller
    const generation = ++generationRef.current
    setState(current => {
      if (pageCursor === undefined) return { status: 'loading' }
      const { message: _message, ...withoutMessage } = current
      return { ...withoutMessage, loadingMore: true }
    })
    try {
      const page = await callArkme<TeamMembers>('team.app.members', {
        teamRef,
        limit: 50,
        ...(pageCursor === undefined ? {} : { pageCursor }),
      }, controller.signal)
      if (controller.signal.aborted || generationRef.current !== generation) return
      setState(current => {
        if (pageCursor === undefined || current.page === undefined) return { status: 'ready', page }
        const members = new Map(current.page.items.map(member => [member.userRef, member]))
        for (const member of page.items) members.set(member.userRef, member)
        return { status: 'ready', page: { ...page, items: [...members.values()] } }
      })
    } catch (error) {
      if (controller.signal.aborted || generationRef.current !== generation) return
      const message = loadErrorMessage(error)
      setState(current => pageCursor === undefined
        ? { status: 'error', message }
        : { ...current, status: 'ready', loadingMore: false, message })
    }
  }, [accountKey, teamRef])

  useEffect(() => {
    setConfirmRemoval(undefined); setConfirmLeave(false); setRemoving('')
    void load()
    return () => {
      generationRef.current += 1
      controllerRef.current?.abort()
    }
  }, [load])

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
      await callArkme('team.app.leave', { teamRef }, controller?.signal)
      if (controller?.signal.aborted) return
      const conversation = readTeamDirectory(accountKey).items.find(c => c.side === 'team' && c.channel.teamRef === teamRef)
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
        <span className="arkme-team-detail-glyph" aria-hidden>{tr("团")}</span>
        <div className="arkme-team-detail-summary">
          <h1>{page.team.name}</h1>
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
      <div className="arkme-team-detail-actions"><button type="button" className="arkme-team-action" onClick={() => { openTeamMessages({ kind: 'team', teamRef }) }}>{tr("查看团队对话")}</button></div>
    </header>
    <TeamChannelSettings key={`${accountKey}:${teamRef}`} teamRef={teamRef} accountKey={accountKey} onChanged={() => { void load() }} />
    {page.team.currentUserRole !== 'owner' && <div className="arkme-team-directory-actions">
      {confirmLeave ? <div className="team-confirm" role="alert">
        <p>{tr('退出后将无法查看或回复团队对话。确认退出？')}</p>
        <button disabled={!!removing} onClick={() => { void leaveTeam() }}>{tr('确认退出')}</button>
        <button disabled={!!removing} onClick={() => { setConfirmLeave(false) }}>{tr('取消')}</button>
      </div> : <button disabled={!!removing} onClick={() => { setConfirmLeave(true) }}>{tr('退出团队')}</button>}
    </div>}
    <section className="arkme-team-members" aria-label={tr("{v0}的成员", { v0: page.team.name })}>
      <div className="arkme-team-members-container">
        <h2>{tr("团队成员")}</h2>
        <div className="arkme-team-member-list" role="list">
          {confirmRemoval && <div className="team-confirm" role="alert"><p>{tr('确认移除 {v0}？', { v0: confirmRemoval.name })}</p>
            <button disabled={!!removing} onClick={() => { void removeMember() }}>{tr('确认')}</button><button disabled={!!removing} onClick={() => { setConfirmRemoval(undefined) }}>{tr('取消')}</button></div>}
          {page.items.map(member => <div className="arkme-team-member-row" role="listitem" key={member.userRef}>
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
  </section>
}
