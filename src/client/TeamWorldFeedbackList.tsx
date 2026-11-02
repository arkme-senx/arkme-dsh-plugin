import type { TeamWorldFeedback } from '../team-world-contract.js'
import type { ArkmeWorldFeedItem } from '../types.js'
import { ArkmeTeamAvatar } from './ArkmeTeamAvatar.js'
import { WorldCard, WorldCollapsibleText } from './ArkmeWorldSurface.js'
import { WorldPreviewImages } from './WorldPreviewImages.js'
import { ReactionLabel } from './ReactionLabel.js'
import { expressionLabel } from './reaction-expression.js'
import { worldManagementTime } from './world-management-ui.js'
import { tr } from './locale.js'

/** Group only the current authorized page; never accumulate historical authority. */
export function TeamWorldFeedbackList({ items, seen, selected, busy, onOpen, onOpenAuthor, onOpenOriginal }: {
  items: TeamWorldFeedback[]; seen: number; selected?: number | undefined; busy: boolean
  onOpen(item: TeamWorldFeedback): void
  onOpenAuthor(item: ArkmeWorldFeedItem): void
  onOpenOriginal(item: TeamWorldFeedback): void
}) {
  const groups = new Map<string, TeamWorldFeedback[]>()
  for (const item of items) {
    const group = groups.get(item.contentRef)
    if (group) group.push(item)
    else groups.set(item.contentRef, [item])
  }
  return <>{[...groups.values()].map(events => {
    const first = events[0]!, preview = first.preview
    // The reference is shared within a response, but renewed on refresh. Keep
    // React identity tied to a stable event, so detail/drafts/focus survive it.
    return <article className="wm-feedback-group" key={first.sequence} aria-label={tr('团队快记与共同反馈')}>
      <div className="wm-feedback-original" role="button" tabIndex={0} aria-label={tr('查看原始快记及评论')} aria-disabled={busy}
        onKeyDown={event => { if (event.target === event.currentTarget && ['Enter', ' '].includes(event.key)) { event.preventDefault(); onOpenOriginal(first) } }}
        onClick={event => {
          if (event.defaultPrevented || event.button !== 0 || event.detail > 1 || !(event.target instanceof Element)) return
          if (event.target.closest('button,a,input,textarea,[role="dialog"]') || window.getSelection()?.toString()) return
          event.currentTarget.focus({ preventScroll: true }); onOpenOriginal(first)
        }}>
        <header><ArkmeTeamAvatar name={preview.teamName} size={40} /><strong>{preview.teamName}</strong><small>{tr('团队')}</small>
          {(preview.deleted || !preview.publicRequested) && <span className="wm-badge">{tr(preview.deleted ? '已删除' : '未公开')}</span>}
        </header>
        <WorldCollapsibleText recordRef={`team-feedback-original-${first.sequence}`} authorName={preview.teamName}
          textContent={[preview.title, preview.text].filter(Boolean).join('\n')} hasMedia={!!preview.imageCount} />
        <WorldPreviewImages imageRefs={preview.imageRefs ?? []} />
      </div>
      <section className="wm-group-events" aria-label={tr('这条快记的共同反馈')}>
        <h3>{tr('共同反馈')}</h3>
        {events.map(item => item.kind === 'comment' && item.comment ? <div className="wm-feedback-card" key={item.sequence}>
          <WorldCard item={item.comment} compact playable={false} voiceprintActive={false} voiceprintLoading={false} interactionsOpen={false}
            selected={selected === item.sequence} onOpenDetail={() => onOpen(item)} onOpenInteractions={() => onOpen(item)}
            onInteractionCreated={() => {}} onToggleVoiceprint={() => {}} onOpenAuthor={onOpenAuthor}
            context={!item.isMe && item.sequence > seen ? <span className="wm-comment-unread wm-unread" aria-label={tr('未读')} /> : undefined} />
        </div> : <div className="wm-feedback-row" key={item.sequence} role="button" tabIndex={0}
          onKeyDown={e => { if (e.target === e.currentTarget && ['Enter', ' '].includes(e.key)) { e.preventDefault(); onOpen(item) } }}
          aria-label={tr('查看反馈详情')} aria-describedby={`feedback-${item.sequence}`} aria-pressed={selected === item.sequence} aria-disabled={busy}
          onClick={e => { e.currentTarget.focus({ preventScroll: true }); onOpen(item) }}>
          <span className="wm-event-avatar" aria-hidden>{(item.isMe ? tr('我') : item.actorName || tr('用户')).slice(0, 1)}</span>
          <div className="wm-event-main" id={`feedback-${item.sequence}`}><span><FeedbackAction item={item} /> {!item.isMe && item.sequence > seen && <span className="wm-unread" aria-label={tr('未读')} />}</span>
            {item.kind === 'comment' && <span className="wm-content-preview">{tr('这条评论已不可访问')}</span>}
          </div><time className="wm-caption" dateTime={new Date(item.at).toISOString()}>{worldManagementTime(item.at)}</time>
        </div>)}
      </section>
    </article>
  })}</>
}

export function FeedbackAction({ item }: { item: TeamWorldFeedback }) {
  const name = item.isMe ? tr('我') : item.actorName || tr('一位用户')
  return <>{tr(item.kind === 'comment' ? '{v0} 评论' : item.reaction ? item.reaction.active ? '{v0} 添加了表态' : '{v0} 取消了表态' : '{v0} 的表态记录暂不可用', { v0: name })}{item.reaction && <> <ReactionLabel label={expressionLabel(item.reaction.expression)} /></>}</>
}
