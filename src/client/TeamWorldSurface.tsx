import { ArkmeMemberProfileCard } from './ArkmeChatMemberActions.js'
import { TeamWorldManagement } from './TeamWorldManagement.js'
import { TeamWorldActivity } from './TeamWorldActivity.js'
import { DotsThree } from '@phosphor-icons/react/dist/icons/DotsThree'
import { ArkmeActionMenu } from './ArkmeDshMenu.js'
import { TeamWorldFeedback } from './TeamWorldFeedback.js'
import { ArkmeDetailShell } from './ArkmeDetailShell.js'
import { WorldCard, WorldInfiniteScrollTrigger, WorldAuthorAvatar, WorldNotificationFocus, WorldTeamReplyContext } from './ArkmeWorldSurface.js'
import { ArkmeWorldRecordDetail } from './ArkmeWorldRecordDetail.js'
import type { ArkmeTeam, ArkmeWorldFeedItem, ArkmeWorldFeedPage, ArkmeWorldNotificationTarget } from '../types.js'
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
  const [author, setAuthor] = useState<ArkmeWorldFeedItem>()
  const [selected, select] = useState<ArkmeWorldFeedItem>(), [commentFocus, setCommentFocus] = useState<string>()
  const [feedbackOpen, setFeedbackOpen] = useState(false), [more, setMore] = useState(false)
  const [management, setManagement] = useState(false), [activity, setActivity] = useState(false)
  const [feedbackVersion, refreshFeedback] = useState(0), [paging, setPaging] = useState(false)
  const [windowed, setWindowed] = useState(false)
  const scrollRoot = useRef<HTMLElement>(null), feedbackBody = useRef<HTMLDivElement>(null)
  const feedPages = useRef<{ cursor?: string; feed: ArkmeWorldFeedPage }[]>([])
  const navigation = useRef<AbortController>(), pageRequest = useRef<AbortController>()
  useEffect(() => () => { navigation.current?.abort(); pageRequest.current?.abort() }, [])
  const open = async (item: ArkmeWorldFeedItem, commentRef?: string) => {
    navigation.current?.abort(); const controller = new AbortController(); navigation.current = controller
    if (!commentRef) { setCommentFocus(undefined); select(item); return }
    try {
      const target = await callArkme<ArkmeWorldNotificationTarget>('world.notification-target', { interactionRef: commentRef }, controller.signal)
      if (!controller.signal.aborted) { setCommentFocus(commentRef); select(target.root) }
    } catch (error) { if (!controller.signal.aborted) setState(current => ({ ...current, error: error instanceof Error ? error.message : tr('评论当前不可访问') })) }
  }
  const loadMore = async () => {
    const cursor = state.value?.feed.nextCursor
    if (!cursor || paging) return
    const controller = new AbortController(); pageRequest.current = controller; setPaging(true)
    try {
      const page = await callArkme<ArkmeWorldFeedPage>('team.world', { action: 'feed', accountKey, jotmoId: target.jotmoId, cursor, limit: 20 }, controller.signal)
      if (controller.signal.aborted) return
      if (page.hasMore && (!page.nextCursor || page.nextCursor === cursor)) throw Error(tr('内容分页未推进，请重试'))
      feedPages.current = [...feedPages.current, { cursor, feed: page }].slice(-5)
      setWindowed(!!feedPages.current[0]?.cursor)
      setState(current => current.value ? { ...current, value: { ...current.value, feed: { ...page, items: [...new Map(feedPages.current.flatMap(part => part.feed.items).map(item => [item.recordRef, item])).values()] } } } : current)
    } catch (error) { if (!controller.signal.aborted) setState(current => ({ ...current, error: error instanceof Error ? error.message : tr('读取失败') })) }
    finally { if (!controller.signal.aborted) setPaging(false) }
  }
  const refresh = useCallback(() => setRevision(value => value + 1), [])
  useEffect(() => {
    const controller = new AbortController()
    pageRequest.current?.abort(); setPaging(false)
    setState(current => ({ ...current, loading: true }))
    void callArkme<TeamWorldView>('team.app.world.view', { expectedAccountKey: accountKey, jotmoId: target.jotmoId, includeMemberTeam: false }, controller.signal).then(async value => {
      if (controller.signal.aborted) return
      if (value.state !== 'ready' || !value.context?.capabilities || !Array.isArray(value.feed?.items) || value.team?.jotmoId !== target.jotmoId || !value.team.name
        || (value.memberTeam && (value.memberTeam.jotmoId !== target.jotmoId || !value.memberTeam.teamRef))) throw new Error(tr('团队世界返回异常，请重试'))
      // Revalidate only the retained five-page window; focus must not jump back to page one.
      const count = Math.max(1, feedPages.current.length), firstCursor = feedPages.current[0]?.cursor
      const fresh: typeof feedPages.current = []
      let cursor = firstCursor
      for (let index = 0; index < count; index++) {
        const feed = index === 0 && !cursor ? value.feed : await callArkme<ArkmeWorldFeedPage>('team.world', { action: 'feed', accountKey, jotmoId: target.jotmoId, cursor, limit: 20 }, controller.signal)
        if (controller.signal.aborted) return
        if (feed.hasMore && (!feed.nextCursor || feed.nextCursor === cursor)) throw Error(tr('内容分页未推进，请重试'))
        fresh.push({ ...(cursor ? { cursor } : {}), feed }); cursor = feed.nextCursor
        if (!feed.hasMore) break
      }
      feedPages.current = fresh; setWindowed(!!firstCursor)
      setState({ value: { ...value, feed: { ...fresh[fresh.length - 1]!.feed, items: [...new Map(fresh.flatMap(part => part.feed.items).map(item => [item.recordRef, item])).values()] } }, loading: false })
      if (!value.context.capabilities.feedback) setFeedbackOpen(false)
      // Member presentation enables publishing, but never gates public reading.
      if (!value.memberTeam && value.context.capabilities.publish) void callArkme<ArkmeTeam[]>('team.app.teams', { expectedAccountKey: accountKey }, controller.signal).then(teams => {
        if (controller.signal.aborted) return
        const memberTeam = teams.find(team => team.jotmoId === target.jotmoId && team.teamRef)
        if (memberTeam) setState(current => current.value ? { ...current, value: { ...current.value, memberTeam, team: { ...current.value.team, ...(memberTeam.avatar ? { avatar: memberTeam.avatar } : {}) } } } : current)
      }).catch(() => {})
    }).catch(error => { if (!controller.signal.aborted) setState({ loading: false, error: error instanceof Error ? error.message : tr('团队世界暂时无法加载') }) })
    return () => controller.abort()
  }, [accountKey, target.jotmoId, revision])
  useEffect(() => { window.addEventListener('focus', refresh); window.addEventListener('arkme-reaction-policy-changed', refresh); return () => { window.removeEventListener('focus', refresh); window.removeEventListener('arkme-reaction-policy-changed', refresh) } }, [refresh])
  const team = { ...target, ...state.value?.team }
  const capabilities = state.value?.context.capabilities
  return <main ref={scrollRoot} aria-label={tr('团队的世界')} style={{ display: 'flex', flex: 1, minHeight: 0, overflowY: 'auto', background: arkmeTheme.base }}>
    <section style={{ width: '100%', maxWidth: 640, minWidth: 0, borderRight: `1px solid ${arkmeTheme.borderSoft}`, boxSizing: 'border-box' }}>
      <header style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 10, padding: '18px 20px', borderBottom: `1px solid ${arkmeTheme.borderSoft}` }}>
        <button type="button" style={icon} aria-label={tr('返回')} onClick={onBack}><ArrowLeft size={20} /></button>
        <h2 style={{ flex: 1, fontSize: 18, margin: 0, overflowWrap: 'anywhere' }}>{tr('{v0}的世界', { v0: team.name })}</h2>
        <button type="button" style={icon} aria-label={tr('刷新团队世界')} disabled={state.loading} onClick={refresh}><ArrowClockwise size={19} /></button>
        {state.value?.memberTeam && capabilities?.publish && <button type="button" style={button} onClick={() => setPublishing(true)}>{tr('发布')}</button>}
        {state.value?.memberTeam && <ArkmeActionMenu open={more} onClose={() => setMore(false)} label={tr('团队世界操作')} align="end"
          anchor={<button type="button" style={icon} aria-label={tr('更多团队世界操作')} onClick={() => setMore(value => !value)}><DotsThree size={22} /></button>}
          actions={[...(capabilities?.manage ? [{ id: 'content', label: tr('团队内容'), onSelect: () => { setMore(false); select(undefined); setFeedbackOpen(false); setActivity(false); setManagement(true) } }] : []), ...(capabilities?.feedback ? [{ id: 'feedback', label: tr('反馈记录'), onSelect: () => { setMore(false); select(undefined); setManagement(false); setActivity(false); setFeedbackOpen(true) } }] : []), { id: 'activity', label: tr('我的团队操作'), onSelect: () => { setMore(false); select(undefined); setFeedbackOpen(false); setManagement(false); setActivity(true) } }]} />}
      </header>
      <div style={{ padding: 24 }}>
        <button type="button" disabled={!state.value} style={{ ...identity, cursor: state.value ? 'pointer' : 'default' }} aria-label={tr('查看团队资料')} onClick={() => setCardOpen(true)}>
          <ArkmeTeamAvatar name={team.name} avatar={team.avatar} size={48} /><span style={{ minWidth: 0 }}><strong style={{ display: 'block', overflowWrap: 'anywhere' }}>{team.name}</strong><small style={{ color: arkmeTheme.secondary }}>@{team.jotmoId} · {tr('团队')}</small></span>
        </button>
        {state.loading && <p role="status" style={hint}>{tr('正在加载团队世界…')}</p>}
        {state.error && <p role="alert" style={hint}>{state.error} <button type="button" style={icon} onClick={refresh}>{tr('重试')}</button></p>}
        {state.value && <div style={{ display: 'grid', gap: 16, marginTop: 20 }}>
          {windowed && <p style={hint}>{tr('当前显示最近加载的 100 条内容')} <button type="button" style={icon} onClick={() => { feedPages.current = []; refresh() }}>{tr('返回最新内容')}</button></p>}
          {state.value.feed.items.map(item => <WorldCard key={item.recordRef} item={item} teamCommentPreview commentPreviewVersion={feedbackVersion} playable={false} voiceprintActive={false} voiceprintLoading={false} interactionsOpen={false} onOpenDetail={item => { setFeedbackOpen(false); void open(item) }} onOpenInteractions={item => { setFeedbackOpen(false); void open(item) }} onInteractionCreated={() => {}} onToggleVoiceprint={() => {}} onOpenAuthor={() => setCardOpen(true)} />)}
          {!state.value.feed.items.length && <p style={hint}>{tr('这个团队还没有公开内容')}</p>}
          {state.value.feed.hasMore && !state.error && <WorldInfiniteScrollTrigger scrollRootRef={scrollRoot} loading={paging || state.loading} error={false} onLoadMore={() => void loadMore()} />}
        </div>}
      </div>
    </section>
    {feedbackOpen && state.value?.context.capabilities.feedback && <ArkmeDetailShell style={{ top: 0 }} bodyRef={feedbackBody} title={tr('反馈记录')} label={tr('反馈记录')} onClose={() => setFeedbackOpen(false)}>
      <TeamWorldFeedback scrollRootRef={feedbackBody} accountKey={accountKey} context={state.value.context} onOpen={(item, commentRef) => { setFeedbackOpen(false); void open(item, commentRef) }} refreshKey={feedbackVersion} />
    </ArkmeDetailShell>}
    {management && state.value?.context.capabilities.manage && <TeamWorldManagement accountKey={accountKey} context={state.value.context} onClose={() => setManagement(false)} onChanged={() => { refresh(); refreshFeedback(value => value + 1) }} />}
    {activity && <TeamWorldActivity team={state.value?.context} onClose={() => setActivity(false)} />}
    {selected && <WorldTeamReplyContext.Provider value={state.value?.context}><WorldNotificationFocus.Provider value={commentFocus}>
      <ArkmeWorldRecordDetail item={selected} onClose={() => select(undefined)} renderAvatar={item => <WorldAuthorAvatar item={item} />} onOpenAuthor={setAuthor}
        renderContent={item => <WorldCard item={item} commentsRefreshKey={item} detail playable={false} voiceprintActive={false} voiceprintLoading={false} interactionsOpen onOpenInteractions={() => {}} onInteractionCreated={() => refreshFeedback(value => value + 1)} onToggleVoiceprint={() => {}} />} />
    </WorldNotificationFocus.Provider></WorldTeamReplyContext.Provider>}
    {author && (author.teamAuthor ? <TeamPublicCardDialog accountKey={accountKey} jotmoId={author.teamAuthor.jotmoId} onClose={() => setAuthor(undefined)} /> : <ArkmeMemberProfileCard member={{ displayName: author.authorName, ...(author.avatarRef ? { avatarRef: author.avatarRef } : {}) }} hideSend busy={false} onClose={() => setAuthor(undefined)} onSend={() => {}} />)}
    {publishing && state.value?.memberTeam && <WorldPublishGuide initialTeam={state.value.memberTeam} onClose={() => setPublishing(false)} />}
    {cardOpen && <TeamPublicCardDialog accountKey={accountKey} jotmoId={team.jotmoId} onClose={() => setCardOpen(false)} />}
  </main>
}
const icon: CSSProperties = { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', padding: 7, border: 0, borderRadius: 8, color: arkmeTheme.secondary, background: 'transparent', cursor: 'pointer', font: 'inherit' }
const button: CSSProperties = { padding: '8px 14px', border: 0, borderRadius: 8, color: arkmeTheme.onPrimaryAction, background: arkmeTheme.primaryAction, cursor: 'pointer', font: 'inherit' }
const identity: CSSProperties = { display: 'flex', alignItems: 'center', gap: 12, maxWidth: '100%', padding: 0, border: 0, textAlign: 'left', font: 'inherit', color: arkmeTheme.text, background: 'transparent' }
const hint: CSSProperties = { fontSize: 13, color: arkmeTheme.secondary, lineHeight: 1.8 }
