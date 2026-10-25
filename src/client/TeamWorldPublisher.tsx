import { useCallback, useEffect, useState, type CSSProperties } from 'react'
import { CaretDown } from '@phosphor-icons/react/dist/icons/CaretDown'
import type { ArkmeTeam } from '../types.js'
import { TEAM_WORLD_PENDING_TEXT } from '../team-world-contract.js'
import { callArkme } from './api.js'
import { ArkmeSelfRoleMenu, type SelfRoleMenuAction } from './ArkmeSelfRoleMenu.js'
import { ArkmeTeamAvatar } from './ArkmeTeamAvatar.js'
import { ArkmeUserAvatar } from './ArkmeAvatar.js'
import { arkmeTheme } from './arkme-theme.js'
import { tr } from './locale.js'

/** Membership candidates are not a server-side grant to publish for a team. */
export function useTeamWorldPublisher(accountKey: string, initialTeam?: ArkmeTeam) {
  const [selected, setSelected] = useState(initialTeam?.jotmoId ?? '')
  const [state, setState] = useState<{ teams: ArkmeTeam[]; loading: boolean; error?: string }>({ teams: [], loading: !!accountKey })
  const [revision, setRevision] = useState(0)
  const refresh = useCallback(() => setRevision(value => value + 1), [])
  useEffect(() => {
    if (!accountKey) return
    const controller = new AbortController()
    setState(current => ({ teams: current.teams, loading: true }))
    void callArkme<ArkmeTeam[]>('team.app.teams', { expectedAccountKey: accountKey }, controller.signal).then(teams => {
      if (controller.signal.aborted) return
      if (!Array.isArray(teams) || teams.some(team => !team.jotmoId || !team.name || !team.teamRef)) throw new Error(tr('团队身份返回异常，请重试'))
      setState({ teams: [...new Map(teams.map(team => [team.jotmoId, team])).values()], loading: false })
    }).catch(error => { if (!controller.signal.aborted) setState({ teams: [], loading: false, error: error instanceof Error ? error.message : tr('团队身份暂不可用') }) })
    return () => controller.abort()
  }, [accountKey, revision])
  useEffect(() => {
    if (!accountKey) return
    window.addEventListener('focus', refresh)
    return () => window.removeEventListener('focus', refresh)
  }, [accountKey, refresh])
  // Never silently downgrade a removed or unverified selected team to a person.
  const team = state.teams.find(value => value.jotmoId === selected)
  return { ...state, selected, team, displayTeam: team ?? (initialTeam?.jotmoId === selected ? initialTeam : undefined), select: setSelected, refresh }
}

export type TeamWorldPublisherState = ReturnType<typeof useTeamWorldPublisher>

export function TeamWorldAuthor({ team, actorName = '我', actorAvatarRef }: {
  team: Pick<ArkmeTeam, 'name' | 'avatar'>; actorName?: string; actorAvatarRef?: string | undefined
}) {
  return <div data-team-world-attribution style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
    <ArkmeTeamAvatar name={team.name} avatar={team.avatar} size={36} />
    <div style={{ minWidth: 0 }}><strong style={{ display: 'block', overflowWrap: 'anywhere' }}>{team.name} <small style={{ fontWeight: 400, color: arkmeTheme.secondary }}>{tr('团队')}</small></strong>
      <span style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, color: arkmeTheme.secondary, marginTop: 5 }}>
        <ArkmeUserAvatar avatarRef={actorAvatarRef} size={18} label={actorName} />{tr('由{v0}发布', { v0: actorName })}
      </span>
    </div>
  </div>
}

export function TeamWorldPublisherPicker({ state, actorName, actorAvatarRef, disabled, onSelect }: {
  state: TeamWorldPublisherState; actorName?: string | undefined; actorAvatarRef?: string | undefined
  disabled: boolean; onSelect(id: string): void
}) {
  const [open, setOpen] = useState(false)
  const close = useCallback(() => setOpen(false), [])
  const choose = (id: string) => { if (!disabled) { onSelect(id); close() } }
  const actions: SelfRoleMenuAction[] = [
    { id: 'personal', label: tr('我'), description: tr('个人内容'), icon: <ArkmeUserAvatar avatarRef={actorAvatarRef} size={28} label={tr('我的头像')} />, onSelect: () => choose('') },
    ...state.teams.map(team => ({ id: `team:${team.jotmoId}`, label: tr('我 · {v0}团队', { v0: team.name }), description: tr('团队内容 · 由我发布'),
      icon: <ArkmeTeamAvatar name={team.name} avatar={team.avatar} size={28} />, disabled: state.loading || disabled, onSelect: () => choose(team.jotmoId) })),
    ...(state.loading ? [{ type: 'label' as const, id: 'loading', text: tr('正在核验团队身份…') }] : []),
    ...(state.error ? [{ id: 'retry', label: tr('重试加载团队身份'), description: state.error, onSelect: state.refresh }] : []),
  ]
  return <section aria-label={tr('发布身份')} style={{ marginTop: 16 }}>
    <ArkmeSelfRoleMenu open={open && !disabled} onClose={close} actions={actions} selectedIds={[state.selected ? `team:${state.selected}` : 'personal']} showSelectionIndicator anchor={
      <button type="button" style={trigger} aria-label={tr('发布身份：{v0}', { v0: state.selected ? state.displayTeam?.name ?? tr('团队身份待核验') : tr('我') })}
        aria-haspopup="dialog" aria-expanded={open && !disabled} disabled={disabled} onClick={() => { if (!open) state.refresh(); setOpen(value => !value) }}>
        {state.selected && state.displayTeam ? <ArkmeTeamAvatar name={state.displayTeam.name} avatar={state.displayTeam.avatar} size={22} /> : <ArkmeUserAvatar avatarRef={actorAvatarRef} size={22} label={tr('我的头像')} />}
        <span>{state.selected ? state.displayTeam?.name ?? tr('团队身份待核验') : tr('我')}</span><CaretDown size={12} />
      </button>
    } />
    {!!state.selected && <div style={{ padding: 12, background: arkmeTheme.subtle, borderRadius: 10, marginTop: 10 }}>
      {state.displayTeam && <TeamWorldAuthor team={state.displayTeam} actorName={actorName ?? tr('我')} actorAvatarRef={actorAvatarRef} />}
      <p style={{ fontSize: 12, lineHeight: 1.7, color: arkmeTheme.secondary, marginBottom: 0 }}>{tr('内容归团队所有，记录实际发布成员。')}</p>
      <p role="status" style={{ fontSize: 12, lineHeight: 1.7, color: arkmeTheme.secondary, marginBottom: 0 }}>{tr(TEAM_WORLD_PENDING_TEXT)}</p>
      {!state.loading && !state.team && <p role="alert">{state.error || tr('当前团队身份不可用，请重新选择；草稿已保留。')}</p>}
    </div>}
  </section>
}

const trigger: CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: 7, maxWidth: '100%', padding: '6px 8px', border: 0, borderRadius: 8, background: arkmeTheme.subtle, color: arkmeTheme.text, cursor: 'pointer', font: 'inherit', fontSize: 13 }
