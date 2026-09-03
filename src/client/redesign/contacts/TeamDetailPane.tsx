import { useCallback, useEffect, useRef, useState } from 'react'

import type { ArkmeTeamMember, ArkmeTeamMemberPage, ArkmeTeamRole } from '../../../types.js'
import { callArkme } from '../../api.js'

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

function memberSubtitle(member: ArkmeTeamMember): string {
  const identity = member.identityState === 'unavailable'
    ? '身份信息暂不可用'
    : member.identityState === 'incomplete'
      ? '身份信息不完整'
      : member.jotmoId ?? ''
  return [ROLE_LABELS[member.role], identity].filter(Boolean).join(' · ')
}

export function TeamDetailPane({ accountKey, teamRef }: { accountKey: string; teamRef: string }) {
  const [state, setState] = useState<TeamDetailState>({ status: 'loading' })
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
    return <div className="arkme-team-detail-status" role="status">正在加载团队成员…</div>
  }
  if (state.status === 'error' || state.page === undefined) {
    return <div className="arkme-team-detail-status is-error" role="alert">
      <span>{state.message ?? '团队成员加载失败'}</span>
      <button type="button" onClick={() => { void load() }}>重试</button>
    </div>
  }

  const { page } = state
  return <section className="arkme-team-detail" data-team-ref={page.team.teamRef}>
    <header className="arkme-team-detail-header">
      <span className="arkme-team-detail-glyph" aria-hidden>团</span>
      <div>
        <h1>{page.team.name}</h1>
        <p>{page.team.jotmoId} · {ROLE_LABELS[page.team.currentUserRole]}</p>
      </div>
      <strong>{page.totalCount} 位成员</strong>
    </header>
    <div className="arkme-team-member-list" role="list" aria-label={`${page.team.name}的成员`}>
      {page.items.map(member => <div className="arkme-team-member-row" role="listitem" key={member.userRef}>
        <span className="arkme-team-member-avatar" aria-hidden>{Array.from(member.displayName)[0] ?? '人'}</span>
        <span className="arkme-team-member-copy">
          <strong>{member.displayName}</strong>
          <small>{memberSubtitle(member)}</small>
        </span>
      </div>)}
      {state.message !== undefined && <div className="arkme-team-member-more-error" role="alert">{state.message}</div>}
      {page.hasMore && page.nextPageCursor !== undefined && <button
        type="button"
        className="arkme-team-member-more"
        disabled={state.loadingMore === true}
        onClick={() => { void load(page.nextPageCursor) }}
      >{state.loadingMore === true ? '加载中…' : '加载更多成员'}</button>}
    </div>
  </section>
}
