import { WorldManagementStyles } from './world-management-ui.js'
import { ArkmeWorldRecordDetail } from './ArkmeWorldRecordDetail.js'
import type { ArkmeWorldFeedItem } from '../types.js'
import { ArkmeMemberProfileCard } from './ArkmeChatMemberActions.js'
import { WorldCard, WorldAuthorAvatar } from './ArkmeWorldSurface.js'
import { TeamWorldManagement } from './TeamWorldManagement.js'
import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react'
import { ArrowLeft } from '@phosphor-icons/react/dist/icons/ArrowLeft'
import { ArrowClockwise } from '@phosphor-icons/react/dist/icons/ArrowClockwise'
import { type TeamWorldTarget, type TeamWorldView } from '../team-world-contract.js'
import { callArkme } from './api.js'
import { WorldPublishGuide } from './WorldPublishGuide.js'
import { ArkmeTeamAvatar } from './ArkmeTeamAvatar.js'
import { TeamPublicCardDialog } from './TeamPublicCardDialog.js'
import { arkmeTheme } from './arkme-theme.js'
import { tr, useArkmeLocale } from './locale.js'

/** Dedicated team namespace: never query a personal user feed with a team ID. */
export function TeamWorldSurface(props: {
  accountKey: string; target: TeamWorldTarget; actorName?: string | undefined; actorAvatarRef?: string | undefined; onBack(): void
}) {
  return <ScopedTeamWorld key={`${props.accountKey}:${props.target.jotmoId}`} {...props} />
}
function ScopedTeamWorld({ accountKey, target, onBack }: Parameters<typeof TeamWorldSurface>[0]) {
  useArkmeLocale()
  const [state, setState] = useState<{ value?: TeamWorldView; loading: boolean; error?: string }>({ loading: true })
  const [revision, setRevision] = useState(0), [publishing, setPublishing] = useState(false), [cardOpen, setCardOpen] = useState(false)
  const moreController = useRef<AbortController>()
  const refresh = useCallback(() => setRevision(value => value + 1), [])
  useEffect(() => {
    moreController.current?.abort()
    setLoadingMore(false)
    const controller = new AbortController()
    setState({ loading: true })
    void callArkme<TeamWorldView>('team.app.world.view', { expectedAccountKey: accountKey, jotmoId: target.jotmoId }, controller.signal).then(value => {
      if (controller.signal.aborted) return
      if (value.state !== 'ready' || !value.context || !value.context.capabilities || !Array.isArray(value.feed?.items) || value.team?.jotmoId !== target.jotmoId || !value.team.name
        || (value.memberTeam && (value.memberTeam.jotmoId !== target.jotmoId || !value.memberTeam.teamRef))) throw new Error(tr('团队世界返回异常，请重试'))
      setState({ value, loading: false })
    }).catch(error => { if (!controller.signal.aborted) setState({ loading: false, error: error instanceof Error ? error.message : tr('团队世界暂时无法加载') }) })
    return () => { controller.abort(); moreController.current?.abort() }
  }, [accountKey, target.jotmoId, revision])
  const [selected, setSelected] = useState<ArkmeWorldFeedItem>()
  const [author, setAuthor] = useState<ArkmeWorldFeedItem>()
  const onCreated = (recordRef: string) => setState(current => current.value ? { ...current, value: { ...current.value, feed: { ...current.value.feed, items: current.value.feed.items.map(item => item.recordRef === recordRef ? { ...item, extendCount: item.extendCount + 1 } : item) } } } : current)
  const [managing, setManaging] = useState(false), [loadingMore, setLoadingMore] = useState(false)
  const team = state.value?.team ?? target
  return <main className="wm" aria-label={tr('团队的世界')} style={{ display: 'flex', flex: 1, minHeight: 0, overflowY: 'auto', background: arkmeTheme.base }}>
    <WorldManagementStyles /><section style={{ width: '100%', maxWidth: managing ? 1080 : 640, minWidth: 0, borderRight: `1px solid ${arkmeTheme.borderSoft}`, boxSizing: 'border-box' }}>
      <header style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 10, padding: '22px 24px', borderBottom: `1px solid ${arkmeTheme.borderSoft}` }}>
        <button type="button" style={icon} aria-label={tr('返回')} onClick={onBack}><ArrowLeft size={20} /></button>
        <h2 style={{ flex: 1, fontSize: 20, fontWeight: 600, margin: 0, overflowWrap: 'anywhere' }}>{tr('{v0}的世界', { v0: team.name })}</h2>
        <button type="button" style={icon} aria-label={tr('刷新团队世界')} disabled={state.loading} onClick={refresh}><ArrowClockwise size={19} /></button>
        {state.value?.memberTeam && <button className="wm-button" data-kind="primary" type="button" onClick={() => setPublishing(true)}>{tr('发布')}</button>}
      </header>
      <div style={{ padding: 24 }}>
        <div className="wm-spread" style={{ flexWrap:'wrap', marginBottom: managing ? 16 : 0 }}>
        <button type="button" disabled={!state.value} style={{ ...identity, cursor: state.value ? 'pointer' : 'default' }} aria-label={tr('查看团队资料')} onClick={() => setCardOpen(true)}>
          <ArkmeTeamAvatar name={team.name} avatar={team.avatar} size={40} /><span style={{ minWidth: 0 }}><strong style={{ display: 'block', fontSize:14, overflowWrap: 'anywhere' }}>{team.name}</strong><small style={{ color: arkmeTheme.secondary }}>@{team.jotmoId} · {tr('团队')}</small></span>
        </button>
        {state.value?.context.capabilities.manage && <button className="wm-button" type="button" onClick={() => setManaging(v => !v)}>{tr(managing ? '查看公开内容' : '管理团队内容与反馈')}</button>}
        </div>
        {state.loading && <p role="status" className="wm-notice">{tr('正在加载团队世界…')}</p>}
        {state.error && <p role="alert" className="wm-notice">{state.error} <button className="wm-button" type="button" onClick={refresh}>{tr('重试')}</button></p>}
        {state.value && managing ? <TeamWorldManagement accountKey={accountKey} context={state.value.context} /> : state.value && <div style={{ display: 'grid', gap: 16, marginTop: 20 }}>
          {state.value.feed.items.map(item => <WorldCard key={item.recordRef} item={item} playable={false} voiceprintActive={false} voiceprintLoading={false} interactionsOpen={false} onOpenDetail={setSelected} onOpenInteractions={setSelected} onInteractionCreated={onCreated} onToggleVoiceprint={() => {}} onOpenAuthor={() => setCardOpen(true)} />)}
          {!state.value.feed.items.length && <p>{tr('这个团队还没有公开内容')}</p>}
          {state.value.feed.hasMore && <button className="wm-button" type="button" disabled={loadingMore} onClick={() => {
            const cursor = state.value?.feed.nextCursor; if (!cursor) return
            moreController.current?.abort(); const c = new AbortController(); moreController.current = c
            setLoadingMore(true)
            void callArkme<TeamWorldView>('team.app.world.view', { expectedAccountKey: accountKey, jotmoId: target.jotmoId, cursor }, c.signal).then(value => {
              if (c.signal.aborted) return
              if (value.state !== 'ready' || value.team?.jotmoId !== target.jotmoId || !Array.isArray(value.feed?.items) || value.feed.hasMore && (!value.feed.nextCursor || value.feed.nextCursor === cursor)) throw new Error(tr('团队世界分页返回异常'))
              setState(current => ({ loading: false, value: { ...value, feed: { ...value.feed, items: [...new Map([...(current.value?.feed.items ?? []), ...value.feed.items].map(item => [item.recordRef, item])).values()] } } }))
            }).catch(error => { if (!c.signal.aborted) setState(current => ({ ...current, error: error instanceof Error ? error.message : tr('加载失败') })) }).finally(() => { if (!c.signal.aborted) setLoadingMore(false) })
          }}>{tr('加载更多')}</button>}
        </div>}
      </div>
    </section>
    {selected && !managing && <ArkmeWorldRecordDetail item={selected} onClose={() => setSelected(undefined)} renderAvatar={item => <WorldAuthorAvatar item={item} />} onOpenAuthor={setAuthor}
      renderContent={item => <WorldCard item={item} playable={false} voiceprintActive={false} voiceprintLoading={false} interactionsOpen detail
        onOpenInteractions={() => {}} onInteractionCreated={onCreated} onToggleVoiceprint={() => {}} onOpenAuthor={setAuthor} />} />}
    {author && (author.teamAuthor ? <TeamPublicCardDialog accountKey={accountKey} jotmoId={author.teamAuthor.jotmoId} onClose={() => setAuthor(undefined)} />
      : <ArkmeMemberProfileCard member={{ displayName: author.authorName, ...(author.avatarRef ? { avatarRef: author.avatarRef } : {}) }} hideSend busy={false} onClose={() => setAuthor(undefined)} onSend={() => {}} />)}
    {publishing && state.value?.memberTeam && <WorldPublishGuide initialTeam={state.value.memberTeam} onClose={() => setPublishing(false)} />}
    {cardOpen && <TeamPublicCardDialog accountKey={accountKey} jotmoId={team.jotmoId} onClose={() => setCardOpen(false)} />}
  </main>
}
const icon: CSSProperties = { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', padding: 7, border: 0, borderRadius: 8, color: arkmeTheme.secondary, background: 'transparent', cursor: 'pointer', font: 'inherit' }
const identity: CSSProperties = { display: 'flex', alignItems: 'center', gap: 12, maxWidth: '100%', padding: 0, border: 0, textAlign: 'left', font: 'inherit', color: arkmeTheme.text, background: 'transparent' }
const hint: CSSProperties = { fontSize: 13, color: arkmeTheme.secondary, lineHeight: 1.8 }
