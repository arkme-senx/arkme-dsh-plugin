import { useCallback, useEffect, useState, type CSSProperties } from 'react'
import { ArrowLeft } from '@phosphor-icons/react/dist/icons/ArrowLeft'
import { ArrowClockwise } from '@phosphor-icons/react/dist/icons/ArrowClockwise'
import { TEAM_WORLD_PENDING_TEXT, type TeamWorldTarget, type TeamWorldView } from '../team-world-contract.js'
import { callArkme } from './api.js'
import { PublishDialog } from './ArkmeWorldSurface.js'
import { ArkmeTeamAvatar } from './ArkmeTeamAvatar.js'
import { TeamPublicCardDialog } from './TeamPublicCardDialog.js'
import { arkmeTheme } from './arkme-theme.js'
import { tr, useArkmeLocale } from './locale.js'
import { arkmeUi } from './ui-controller.js'

/** Dedicated team namespace: never query a personal user feed with a team ID. */
export function TeamWorldSurface(props: {
  accountKey: string; target: TeamWorldTarget; actorName?: string | undefined; actorAvatarRef?: string | undefined; onBack(): void
}) {
  return <ScopedTeamWorld key={`${props.accountKey}:${props.target.jotmoId}`} {...props} />
}
function ScopedTeamWorld({ accountKey, target, actorName, actorAvatarRef, onBack }: Parameters<typeof TeamWorldSurface>[0]) {
  useArkmeLocale()
  const [state, setState] = useState<{ value?: TeamWorldView; loading: boolean; error?: string }>({ loading: true })
  const [revision, setRevision] = useState(0), [publishing, setPublishing] = useState(false), [cardOpen, setCardOpen] = useState(false)
  const refresh = useCallback(() => setRevision(value => value + 1), [])
  useEffect(() => {
    const controller = new AbortController()
    setState({ loading: true })
    void callArkme<TeamWorldView>('team.app.world.view', { expectedAccountKey: accountKey, jotmoId: target.jotmoId }, controller.signal).then(value => {
      if (controller.signal.aborted) return
      if (value.state !== 'backend_pending' || value.team?.jotmoId !== target.jotmoId || !value.team.name
        || (value.memberTeam && (value.memberTeam.jotmoId !== target.jotmoId || !value.memberTeam.teamRef))) throw new Error(tr('团队世界返回异常，请重试'))
      setState({ value, loading: false })
    }).catch(error => { if (!controller.signal.aborted) setState({ loading: false, error: error instanceof Error ? error.message : tr('团队世界暂时无法加载') }) })
    return () => controller.abort()
  }, [accountKey, target.jotmoId, revision])
  const team = state.value?.team ?? target
  return <main aria-label={tr('团队的世界')} style={{ display: 'flex', flex: 1, minHeight: 0, overflowY: 'auto', background: arkmeTheme.base }}>
    <section style={{ width: '100%', maxWidth: 640, minWidth: 0, borderRight: `1px solid ${arkmeTheme.borderSoft}`, boxSizing: 'border-box' }}>
      <header style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 10, padding: '18px 20px', borderBottom: `1px solid ${arkmeTheme.borderSoft}` }}>
        <button type="button" style={icon} aria-label={tr('返回')} onClick={onBack}><ArrowLeft size={20} /></button>
        <h2 style={{ flex: 1, fontSize: 18, margin: 0, overflowWrap: 'anywhere' }}>{tr('{v0}的世界', { v0: team.name })}</h2>
        <button type="button" style={icon} aria-label={tr('刷新团队世界')} disabled={state.loading} onClick={refresh}><ArrowClockwise size={19} /></button>
        {state.value?.memberTeam && <button type="button" style={button} onClick={() => setPublishing(true)}>{tr('发布')}</button>}
      </header>
      <div style={{ padding: 24 }}>
        <button type="button" disabled={!state.value} style={{ ...identity, cursor: state.value ? 'pointer' : 'default' }} aria-label={tr('查看团队资料')} onClick={() => setCardOpen(true)}>
          <ArkmeTeamAvatar name={team.name} avatar={team.avatar} size={48} /><span style={{ minWidth: 0 }}><strong style={{ display: 'block', overflowWrap: 'anywhere' }}>{team.name}</strong><small style={{ color: arkmeTheme.secondary }}>@{team.jotmoId} · {tr('团队')}</small></span>
        </button>
        {state.loading && <p role="status" style={hint}>{tr('正在加载团队世界…')}</p>}
        {state.error && <p role="alert" style={hint}>{state.error} <button type="button" style={icon} onClick={refresh}>{tr('重试')}</button></p>}
        {state.value && <div role="status" style={{ ...hint, marginTop: 32, padding: 18, borderRadius: 12, background: arkmeTheme.subtle }}>
          <p>{tr(TEAM_WORLD_PENDING_TEXT)}</p><p style={{ marginBottom: 0 }}>{tr('接口接通后，这里统一展示该团队发布的公开内容。')}</p>
        </div>}
      </div>
    </section>
    {publishing && state.value?.memberTeam && <PublishDialog initialTeam={state.value.memberTeam} actorName={actorName} actorAvatarRef={actorAvatarRef}
      onClose={() => setPublishing(false)} onPublished={() => { setPublishing(false); arkmeUi.showWorld('mine') }} />}
    {cardOpen && <TeamPublicCardDialog accountKey={accountKey} jotmoId={team.jotmoId} onClose={() => setCardOpen(false)} />}
  </main>
}
const icon: CSSProperties = { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', padding: 7, border: 0, borderRadius: 8, color: arkmeTheme.secondary, background: 'transparent', cursor: 'pointer', font: 'inherit' }
const button: CSSProperties = { padding: '8px 14px', border: 0, borderRadius: 8, color: arkmeTheme.onPrimaryAction, background: arkmeTheme.primaryAction, cursor: 'pointer', font: 'inherit' }
const identity: CSSProperties = { display: 'flex', alignItems: 'center', gap: 12, maxWidth: '100%', padding: 0, border: 0, textAlign: 'left', font: 'inherit', color: arkmeTheme.text, background: 'transparent' }
const hint: CSSProperties = { fontSize: 13, color: arkmeTheme.secondary, lineHeight: 1.8 }
