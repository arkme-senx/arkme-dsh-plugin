import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { TeamWorldContext, TeamWorldOriginal, TeamWorldReceipt, TeamWorldFeedback, TeamWorldRequest, TeamWorldFeedbackTarget } from '../team-world-contract.js'
import { callArkme } from './api.js'
import { tr } from './locale.js'
import { WorldManagementStyles, WorldEmpty, worldManagementTime } from './world-management-ui.js'
import { ArkmeConfirmDialog } from './ArkmeConfirmDialog.js'
import type { ReactionSnapshot } from '../reaction-contract.js'
import { ArkmeActionMenu } from './ArkmeDshMenu.js'
import { FileText } from '@phosphor-icons/react/dist/icons/FileText'
import { ChatCircle } from '@phosphor-icons/react/dist/icons/ChatCircle'
import { WorldPreviewImages } from './WorldPreviewImages.js'
import { WorldCard, WorldAuthorAvatar } from './ArkmeWorldSurface.js'
import { ArkmeWorldRecordDetailView } from './ArkmeWorldRecordDetail.js'
import { ArkmeDetailShell } from './ArkmeDetailShell.js'
import { invalidateWorldImages } from './world-image-cache.js'
import { TeamPublicCardDialog } from './TeamPublicCardDialog.js'
import { ArkmeMemberProfileCard } from './ArkmeChatMemberActions.js'
import type { ArkmeWorldFeedItem } from '../types.js'
import { DotsThree } from '@phosphor-icons/react/dist/icons/DotsThree'
import { Archive } from '@phosphor-icons/react/dist/icons/Archive'
import { PencilSimple } from '@phosphor-icons/react/dist/icons/PencilSimple'
import { Trash } from '@phosphor-icons/react/dist/icons/Trash'
import { Check } from '@phosphor-icons/react/dist/icons/Check'
import type { ReactionTargetRef } from '../reaction-contract.js'
import type { WorldReactionContextPage } from '../world-reaction-contract.js'
import { WorldReactionArchive } from './ArkmeWorldReactionHistory.js'

import { TeamWorldOriginalDetail } from './TeamWorldOriginalDetail.js'
import { TeamWorldFeedbackList, FeedbackAction } from './TeamWorldFeedbackList.js'


export function TeamWorldManagement({ accountKey, context }: { accountKey: string; context: TeamWorldContext }) {
  const [tab, setTab] = useState<'originals' | 'deleted' | 'feedback'>('originals')
  const [originals, setOriginals] = useState<TeamWorldOriginal[]>([]), [feedback, setFeedback] = useState<TeamWorldFeedback[]>([])
  const [cursor, setCursor] = useState<string>(), [after, setAfter] = useState(0), [offered, setOffered] = useState(0)
  const [more, setMore] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState(''), [revision, refresh] = useState(0)
  const [edit, setEdit] = useState<TeamWorldOriginal>(), [text, setText] = useState('')
  const [seen, setSeen] = useState(0), [selected, setSelected] = useState<{ sequence: number; kind: 'feedback' | 'original'; source?: TeamWorldFeedback }>()
  const [withdraw, setWithdraw] = useState<{ item: TeamWorldOriginal; count: number }>()
  const [menu, setMenu] = useState<string>()
  const [archiveRecord, setArchiveRecord] = useState<string>()
  const [detail, setDetail] = useState<TeamWorldFeedbackTarget>(), [archive, setArchive] = useState<ReactionTargetRef>()
  const pending = useRef<TeamWorldRequest>(), controller = useRef<AbortController>()
  // Capabilities (including feedback.key) rotate on reads; sequence is the stable team-scoped event identity.
  const pageAfter = useRef(0), returnFocus = useRef<HTMLElement | null>(null)
  const [author, setAuthor] = useState<ArkmeWorldFeedItem>()
  const replaceFeedback = (next: TeamWorldFeedback[]) => {
    const retainedImages = new Set(next.flatMap(item => item.preview.imageRefs ?? []))
    invalidateWorldImages(feedback.flatMap(item => item.preview.imageRefs ?? []).filter(ref => !retainedImages.has(ref)))
    if (detail?.comment && !next.find(item => item.sequence === selected?.sequence)?.comment) invalidateWorldImages(detail.comment.imageRefs)
    for (const old of feedback) if (old.comment && !next.find(item => item.sequence === old.sequence)?.comment) invalidateWorldImages(old.comment.imageRefs)
    setFeedback(next)
  }
  const applyDetail = (target: TeamWorldFeedbackTarget, item: TeamWorldFeedback) => {
    setDetail(current => ({ ...target, ...(target.comment ? { comment: { ...target.comment, recordRef: current?.comment?.recordRef ?? item.comment?.recordRef ?? target.comment.recordRef } } : {}) }))
    setArchive(target.target)
  }
  const load = async (append = false, revalidate = false, refreshDetail = true) => {
    if (!revalidate) { setDetail(undefined); setArchive(undefined); setSelected(undefined); setOriginals([]); setFeedback([]) }
    controller.current?.abort(); const c = new AbortController(); controller.current = c
    setBusy(true); setError('')
    try {
      if (tab === 'feedback') {
        const start = revalidate ? pageAfter.current : append ? after : 0
        const active = revalidate && refreshDetail && selected?.kind === 'feedback' ? feedback.find(item => item.sequence === selected?.sequence) : undefined
        const [page, target] = await Promise.all([
          callArkme<{ items: TeamWorldFeedback[]; hasMore: boolean; afterSequence: number; offeredThrough: number; seenThrough: number }>('team.world', { action: 'feedback', accountKey, teamRef: context.teamRef, afterSequence: start, includeRead: true, limit: 20 }, c.signal),
          active ? callArkme<TeamWorldFeedbackTarget>('team.world', { action: 'feedback-target', accountKey, eventRef: active.eventRef }, c.signal) : undefined,
        ])
        if (c.signal.aborted) return
        pageAfter.current = start
        replaceFeedback(page.items); setMore(page.hasMore); setAfter(page.afterSequence); setOffered(page.offeredThrough); setSeen(page.seenThrough)
        if (active && target && page.items.some(item => item.sequence === active.sequence)) applyDetail(target, active)
        else if (revalidate && selected) {
          const current = page.items.find(item => item.sequence === selected.sequence)
          if (!current) { setDetail(undefined); setArchive(undefined); setSelected(undefined) }
          else if (selected.kind === 'original') {
            // Accepted replies refresh the feedback list, not the unchanged parent
            // and its composer. Focus/permission refreshes still re-read authority.
            const source = selected.source
            if (refreshDetail || !source || source.preview.publicRequested !== current.preview.publicRequested || source.preview.deleted !== current.preview.deleted)
              setSelected(value => value?.kind === 'original' && value.sequence === current.sequence ? { ...value, source: current } : value)
          } else if (!current.comment) { setDetail(undefined); setArchive(undefined) }
        }
      } else {
        const page = await callArkme<{ items: TeamWorldOriginal[]; hasMore: boolean; nextCursor?: string }>('team.world', { action: 'originals', accountKey, teamRef: context.teamRef, deleted: tab === 'deleted', ...(append && cursor ? { cursor } : {}), limit: 20 }, c.signal)
        if (c.signal.aborted) return
        setOriginals(page.items); setMore(page.hasMore); setCursor(page.nextCursor)
      }
    } catch (e) { if (!c.signal.aborted) { setOriginals([]); replaceFeedback([]); setDetail(undefined); setArchive(undefined); setSelected(undefined); setAuthor(undefined); setMore(false); setError(e instanceof Error ? e.message : tr('读取失败，请重试')) } }
    finally { if (!c.signal.aborted) setBusy(false) }
  }
  useEffect(() => { setWithdraw(undefined); setOriginals([]); setFeedback([]); setMore(false); setDetail(undefined); setArchive(undefined); setArchiveRecord(undefined); setSelected(undefined); setMenu(undefined); setAuthor(undefined); void load(); return () => controller.current?.abort() }, [accountKey, context.teamRef, tab, revision])
  useEffect(() => {
    const revalidate = () => {
      if (pending.current || edit || busy) return
      if (tab === 'feedback') void load(false, true)
      else refresh(v => v + 1)
    }
    window.addEventListener('focus', revalidate)
    window.addEventListener('arkme-reaction-policy-changed', revalidate)
    return () => { window.removeEventListener('focus', revalidate); window.removeEventListener('arkme-reaction-policy-changed', revalidate) }
  }, [accountKey, context.teamRef, edit, busy, selected, detail, feedback, tab])
  const openFeedback = async (item: TeamWorldFeedback) => {
    if (busy) return
    returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    setSelected({ sequence: item.sequence, kind: 'feedback' }); setDetail(undefined); setArchive(undefined)
    controller.current?.abort(); const c = new AbortController(); controller.current = c; setBusy(true); setError('')
    try {
      const target = await callArkme<TeamWorldFeedbackTarget>('team.world', { action: 'feedback-target', accountKey, eventRef: item.eventRef }, c.signal)
      if (!c.signal.aborted) {
        // The list stays mounted, but its selected projection must lose access too.
        replaceFeedback(feedback.map(value => {
          if (value.sequence !== item.sequence) return value
          const { comment: _previous, ...rest } = value
          return target.comment ? { ...rest, comment: target.comment } : rest
        }))
        applyDetail(target, item)
      }
    } catch (e) { if (!c.signal.aborted) { replaceFeedback([]); setDetail(undefined); setArchive(undefined); setSelected(undefined); setAuthor(undefined); setMore(false); setError(e instanceof Error ? e.message : tr('当前没有查看权限')) } }
    finally { if (!c.signal.aborted) setBusy(false) }
  }
  const openArchive = async (item: TeamWorldOriginal) => {
    setArchiveRecord(item.recordRef)
    controller.current?.abort(); const c = new AbortController(); controller.current = c; setBusy(true); setError(''); setArchive(undefined)
    try {
      const page = await callArkme<WorldReactionContextPage>('world.reactions.prepare', { accountKey, recordRefs: [item.recordRef] }, c.signal)
      if (!c.signal.aborted) {
        if (!page.items[0]) throw new Error(tr('这份原稿的表态归档暂不可用'))
        setArchive(page.items[0].target)
      }
    } catch (e) { if (!c.signal.aborted) setError(e instanceof Error ? e.message : tr('归档读取失败')) }
    finally { if (!c.signal.aborted) setBusy(false) }
  }
  const confirmWithdrawal = async (item: TeamWorldOriginal) => {
    if (busy || pending.current) return
    controller.current?.abort(); const c = new AbortController(); controller.current = c
    setBusy(true); setError('')
    try {
      const page = await callArkme<WorldReactionContextPage>('world.reactions.prepare', { accountKey, recordRefs: [item.recordRef] }, c.signal)
      const target = page.items[0]?.target
      if (!target) throw new Error(tr('无法确认当前世界表态，请刷新后重试'))
      const result = await callArkme<{ items: ReactionSnapshot[] }>('world.reactions.archive', { accountKey, action: 'query', targets: [target], actorPresentation: 'deferred' }, c.signal)
      if (c.signal.aborted) return
      const count = result.items[0]?.actor_count
      if (!Number.isSafeInteger(count) || count! < 0) throw new Error(tr('无法确认世界表态人数，请重试'))
      setWithdraw({ item, count: count! })
    } catch (e) { if (!c.signal.aborted) setError(e instanceof Error ? e.message : tr('读取失败，请重试')) }
    finally { if (!c.signal.aborted) setBusy(false) }
  }
  const submit = async (item: TeamWorldOriginal, change: 'publish' | 'edit' | 'unpublish' | 'delete' | 'restore') => {
    if (busy) return
    pending.current = { action: 'submit', accountKey, teamRef: context.teamRef, contentRef: item.contentRef, requestUid: crypto.randomUUID(), expectedRevision: item.revision, change,
      ...(change === 'edit' ? { draft: { title: item.title, text, format: item.format, imageRefs: item.assets.map(a => a.imageRef) } } : {}) }
    await retry()
  }
  const retry = async () => {
    if (!pending.current) return
    controller.current?.abort(); const c = new AbortController(); controller.current = c; setBusy(true); setError('')
    try {
      const result = await callArkme<TeamWorldReceipt>('team.world', pending.current, c.signal)
      if (c.signal.aborted) return
      if (result.pending) { setError(tr('操作已接受，正在完成；可重试确认原操作。')); return }
      pending.current = undefined; setEdit(undefined); refresh(v => v + 1)
    } catch (e) { if (!c.signal.aborted) setError(e instanceof Error ? e.message : tr('结果未确认，请重试原操作')) }
    finally { if (!c.signal.aborted) setBusy(false) }
  }
  const read = async () => {
    controller.current?.abort(); const c = new AbortController(); controller.current = c; setBusy(true); setError('')
    try { await callArkme('team.world', { action: 'feedback-read', accountKey, teamRef: context.teamRef, throughSequence: offered }, c.signal); if (!c.signal.aborted) setSeen(offered) }
    catch (e) { if (!c.signal.aborted) setError(e instanceof Error ? e.message : tr('确认失败')) }
    finally { if (!c.signal.aborted) setBusy(false) }
  }
  const clearDetail = () => { controller.current?.abort(); setBusy(false); setDetail(undefined); setArchive(undefined); setSelected(undefined); if (busy) void load(false, true, false) }
  const selectedFeedback = feedback.find(item => item.sequence === selected?.sequence)
  return <section className="wm" aria-label={tr('团队内容管理')}>
    <WorldManagementStyles />
    {withdraw && <ArkmeConfirmDialog titleId="world-withdraw-title" title={tr('撤回公开？')} busy={busy}
      description={tr('当前版本有 {v0} 人表态。撤回后，其他人将无法访问正文、图片和评论；历史表态保留为只读归档。', { v0: withdraw.count })}
      confirmLabel={tr('撤回公开')} busyLabel={tr('正在撤回…')} onClose={() => setWithdraw(undefined)}
      onConfirm={() => { const item = withdraw.item; setWithdraw(undefined); void submit(item, 'unpublish') }} />}
    <div className="wm-toolbar">
      <nav className="wm-tabs" aria-label={tr('团队内容分类')}>{(['originals','feedback','deleted'] as const).map(t => <button className="wm-tab" key={t} type="button" aria-pressed={tab === t} disabled={busy || !!pending.current} onClick={() => setTab(t)}>{tr(t === 'originals' ? '团队内容' : t === 'deleted' ? '已删除' : '共同反馈')}</button>)}</nav>
      <span className="wm-caption">{tr(tab === 'feedback' ? '与有权限的同事共同处理' : tab === 'deleted' ? '恢复后仍为未公开' : '内容归团队所有')}</span>
    </div>
    {error && <div role="alert" className="wm-notice"><span>{error}</span><button className="wm-button" type="button" disabled={busy} onClick={() => pending.current ? void retry() : refresh(v => v + 1)}>{tr('重试')}</button></div>}
    {busy && !selected && <p role="status" className="wm-notice">{tr('正在处理…')}</p>}
    {tab === 'feedback' ? <div className="wm-feedback">
      <div className="wm-feedback-list">
        <div className="wm-feedback-scroll"><TeamWorldFeedbackList items={feedback} seen={seen} selected={selected?.kind === 'feedback' ? selected.sequence : undefined} busy={busy}
          onOpen={item => { void openFeedback(item) }} onOpenAuthor={setAuthor}
          onOpenOriginal={item => { if (busy) return; returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null; setDetail(undefined); setArchive(undefined); setSelected({ sequence: item.sequence, kind: 'original', source: item }) }} /></div>
        {!busy && !error && !feedback.length && <WorldEmpty icon={<ChatCircle size={23} />} title={tr('暂无团队反馈')}>{tr('公开内容收到的评论和表态会显示在这里。')}</WorldEmpty>}
        <div className="wm-list-footer">
          {offered > 0 && <button className="wm-button" data-kind="quiet" type="button" disabled={busy || offered <= seen} onClick={() => void read()} aria-label={tr('将已展示反馈标为已读')}><Check size={15} />{tr(offered <= seen ? '已读' : '标为已读')}</button>}
          {more && <button className="wm-button" type="button" disabled={busy} onClick={() => void load(true)}>{tr('下一页')}</button>}
        </div>
      </div>
      {selectedFeedback && createPortal(<div className="wm wm-feedback-overlay"><WorldManagementStyles />
        {selected?.kind === 'original' ? <TeamWorldOriginalDetail key={`${accountKey}:${selected.sequence}`} accountKey={accountKey} source={selected.source ?? selectedFeedback}
          returnFocusRef={returnFocus} onClose={clearDetail} onOpenAuthor={setAuthor} onUpdated={() => { void load(false, true, false) }}
          onUnavailable={message => { replaceFeedback([]); setDetail(undefined); setArchive(undefined); setSelected(undefined); setAuthor(undefined); setMore(false); setError(message) }} />
        : selectedFeedback.kind === 'comment' && detail?.comment ? <ArkmeWorldRecordDetailView item={detail.comment} onClose={clearDetail} returnFocusRef={returnFocus}
          renderAvatar={value => <WorldAuthorAvatar item={value} />} onOpenAuthor={setAuthor}>
          <WorldCard item={detail.comment} commentsRefreshKey={detail.comment} playable={false} voiceprintActive={false} voiceprintLoading={false} interactionsOpen detail
            context={<p className="wm-feedback-context"><span><FeedbackAction item={selectedFeedback} /> · <FeedbackContentName item={selectedFeedback} /></span></p>}
            onOpenInteractions={() => {}} onInteractionCreated={() => { void load(false, true, false) }} onToggleVoiceprint={() => {}} onOpenAuthor={setAuthor} />
        </ArkmeWorldRecordDetailView> : <ArkmeDetailShell title={tr(selectedFeedback.kind === 'comment' ? '评论详情' : '表态详情')} label={tr('团队反馈详情')} closeLabel={tr('关闭反馈详情')}
          style={{ top: 0 }} returnFocusRef={returnFocus} onClose={clearDetail}>
          {!detail ? <p role="status">{tr('正在读取最新内容…')}</p> : <>
            <h3 className="wm-detail-action"><FeedbackAction item={selectedFeedback} /></h3>
            <time className="wm-caption">{worldManagementTime(selectedFeedback.at)}</time>
            <p className="wm-feedback-context"><span>{tr('关联内容')} · <FeedbackContentName item={selectedFeedback} /></span></p>
            {selectedFeedback.kind === 'comment' ? <p className="wm-notice">{tr('这条评论已不可访问')}</p> : archive && <WorldReactionArchive key={archive.id} scope={accountKey} target={archive} />}
          </>}
        </ArkmeDetailShell>}
      </div>, document.body)}
    </div> : <div className="wm-stack">{originals.map(item => <article className="wm-card" key={item.contentRef}>
      <header><div className="wm-heading"><FileText size={19} /><strong className="wm-title">{item.title || tr('团队内容')}</strong></div><span className="wm-badge" data-tone={item.pending ? 'warning' : item.publicRequested && !item.deleted ? 'info' : undefined}>{tr(item.pending ? '操作处理中' : item.deleted ? '已删除，可恢复' : item.publicRequested ? '已提交公开' : '未公开')}</span></header>
      <p className="wm-card-body wm-content-summary">{item.text}</p>
      <WorldPreviewImages imageRefs={item.assets.map(a => a.imageRef)} />
      <footer className="wm-card-footer"><time className="wm-caption" dateTime={new Date(item.updatedAt).toISOString()}>{tr('更新于 {v0}', { v0: worldManagementTime(item.updatedAt) })}</time><div className="wm-actions">
        {item.deleted ? <button className="wm-button" type="button" disabled={busy || !!pending.current || item.pending} onClick={() => void submit(item, 'restore')}>{tr('恢复为未公开')}</button> : <>
          <button className="wm-button" data-kind="quiet" type="button" disabled={busy || !!pending.current || item.pending} onClick={() => { setEdit(item); setText(item.text) }}><PencilSimple size={15} />{tr('编辑')}</button>
          {!item.publicRequested && <button className="wm-button" type="button" disabled={busy || !!pending.current || item.pending} onClick={() => void submit(item, 'publish')}>{tr('发布')}</button>}
        </>}
        <ArkmeActionMenu open={menu === item.contentRef} autoFocus label={tr('原件操作')} align="end" onClose={() => setMenu(undefined)}
          anchor={<button className="wm-button wm-icon-button" data-kind="quiet" type="button" aria-label={tr('更多原件操作')} aria-haspopup="menu" aria-expanded={menu === item.contentRef} disabled={busy || !!pending.current} onClick={() => setMenu(menu === item.contentRef ? undefined : item.contentRef)}><DotsThree size={20} /></button>}
          actions={[
            { id:'archive', label:tr('表态归档'), icon:<Archive size={18} />, onSelect:() => { setMenu(undefined); void openArchive(item) } },
            ...(!item.deleted && item.publicRequested ? [{ id:'unpublish', label:tr('撤回公开'), disabled:item.pending, onSelect:() => { setMenu(undefined); void confirmWithdrawal(item) } }] : []),
            ...(!item.deleted ? [{ id:'delete', label:tr('删除'), danger:true, disabled:item.pending, icon:<Trash size={18} />, onSelect:() => { setMenu(undefined); void submit(item, 'delete') } }] : []),
          ]} />
      </div></footer>
      {edit?.contentRef === item.contentRef && <div className="wm-editor"><label className="wm-muted">{tr('编辑团队正文')}<textarea aria-label={tr('编辑团队正文')} value={text} disabled={busy || !!pending.current} onChange={e => setText(e.target.value)} maxLength={2000} /></label><div className="wm-actions"><button className="wm-button" data-kind="primary" type="button" disabled={busy || !!pending.current} onClick={() => void submit(item, 'edit')}>{tr('保存')}</button><button className="wm-button" data-kind="quiet" type="button" disabled={busy || !!pending.current} onClick={() => setEdit(undefined)}>{tr('取消')}</button></div></div>}
      {archive && archiveRecord === item.recordRef && <div><WorldReactionArchive key={archive.id} scope={accountKey} target={archive} /><button className="wm-button" data-kind="quiet" type="button" onClick={() => { setArchive(undefined); setArchiveRecord(undefined) }}>{tr('收起归档')}</button></div>}
    </article>)}</div>}
    {tab !== 'feedback' && !busy && !error && !originals.length && <WorldEmpty icon={<FileText size={24} />} title={tr(tab === 'deleted' ? '没有已删除的内容' : '暂无团队原件')}>{tr(tab === 'deleted' ? '删除的团队内容会保留在这里。' : '代表团队发布的内容会保存在这里。')}</WorldEmpty>}
    {author && (author.teamAuthor ? <TeamPublicCardDialog accountKey={accountKey} jotmoId={author.teamAuthor.jotmoId} onClose={() => setAuthor(undefined)} />
      : <ArkmeMemberProfileCard member={{ displayName: author.authorName, ...(author.avatarRef ? { avatarRef: author.avatarRef } : {}), ...(author.avatarFallback ? { avatarFallback: author.avatarFallback } : {}) }} hideSend busy={false} onClose={() => setAuthor(undefined)} onSend={() => {}} />)}
    {tab !== 'feedback' && more && <div className="wm-list-footer"><button className="wm-button" type="button" disabled={busy} onClick={() => void load(true)}>{tr('下一页')}</button></div>}
  </section>
}

function FeedbackContentName({ item }: { item: TeamWorldFeedback }) {
  return <>{item.preview ? item.preview.title || item.preview.text || tr('图片内容') : tr('当前无权查看关联内容')}</>
}
