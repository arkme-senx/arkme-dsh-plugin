import { tr, useArkmeLocale } from '../../locale.js'
import { useCallback, useEffect, useRef, useState } from 'react'

import type { ArkmeTeamMember, ArkmeTeamMemberPage, ArkmeTeamRole } from '../../../types.js'
import { callArkme } from '../../api.js'
import { ArkmeUserAvatar } from '../../ArkmeAvatar.js'
import { TeamCodexSyncDialog } from './TeamCodexSyncDialog.js'
import { arkmeUi } from '../../ui-controller.js'

interface TeamDetailState {
  status: 'loading' | 'ready' | 'error'
  page?: ArkmeTeamMemberPage
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
  const [syncOpen, setSyncOpen] = useState(initialView === 'activity')
  useEffect(() => { setSyncOpen(initialView === 'activity') }, [initialView])
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
      const page = await callArkme<ArkmeTeamMemberPage>('team.members.list', {
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
    void load()
    return () => {
      generationRef.current += 1
      controllerRef.current?.abort()
    }
  }, [load])

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
    </header>
    <section className="arkme-team-features" aria-label={tr('团队功能')}>
      <div className="arkme-team-features-container">
        <h2>{tr('团队功能')}</h2>
        <div className="arkme-team-feature-list">
          <button type="button" className="arkme-team-feature" aria-haspopup="dialog" aria-expanded={syncOpen} onClick={() => setSyncOpen(true)}>
            <span className="arkme-team-feature-icon" aria-hidden="true">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="4" width="18" height="16" rx="4" />
                <path d="m9 9-3 3 3 3m6-6 3 3-3 3" />
              </svg>
            </span>
            <span>{tr('Codex 同步')}</span>
            <span className="arkme-team-feature-arrow" aria-hidden="true">›</span>
          </button>
        </div>
      </div>
    </section>
    <section className="arkme-team-members" aria-label={tr("{v0}的成员", { v0: page.team.name })}>
      <div className="arkme-team-members-container">
        <h2>{tr("团队成员")}</h2>
        <div className="arkme-team-member-list" role="list">
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
            <span className="arkme-team-member-role" data-team-member-role={member.role}>
              {ROLE_LABELS[member.role]}
            </span>
            <button type="button" className="arkme-team-member-conversations"
              aria-label={tr('查看 {name} 的 Codex 对话',{name:member.displayName})}
              onClick={() => arkmeUi.showCodex({accountKey,team:page.team,member:member.userRef,memberName:member.displayName,fromTeam:true,returnView:'members'})}>
              {tr('查看对话')} <span aria-hidden>›</span>
            </button>
          </div>)}
          {state.message !== undefined && <div className="arkme-team-member-more-error" role="alert">{state.message}</div>}
          {page.hasMore && page.nextPageCursor !== undefined && <button
            type="button"
            className="arkme-team-member-more"
            disabled={state.loadingMore === true}
            onClick={() => { void load(page.nextPageCursor) }}
          >{state.loadingMore === true ? tr("加载中…") : '加载更多成员'}</button>}
        </div>
      </div>
    </section>
    {syncOpen && <TeamCodexSyncDialog team={page.team} onClose={() => setSyncOpen(false)} onViewConversations={() => {
      setSyncOpen(false)
      arkmeUi.showCodex({ accountKey, team: page.team, member: '', fromTeam: true, returnView: 'activity' })
    }} />}
  </section>
}
