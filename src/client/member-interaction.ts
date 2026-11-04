import { useEffect, useState } from 'react'
import type { ArkmeConversationMemberItem, ArkmeConversationMemberPresentation, ArkmeSourceItem, ArkmeTimelineItem } from '../types.js'
import { validateMemberUpdate } from '../member-directory.js'
import { callArkme } from './api.js'
import { tr } from './locale.js'

/** A message supplies identity, not current membership, permissions or statistics. */
export type MemberActionTarget = Pick<ArkmeConversationMemberItem, 'memberRef' | 'displayName' | 'isSelf'>
  & Partial<Omit<ArkmeConversationMemberItem, 'memberRef' | 'displayName' | 'isSelf'>>

export function messageMemberTarget(item: ArkmeTimelineItem, known?: ArkmeConversationMemberItem): MemberActionTarget | undefined {
  if (item.senderKind === 'bot') return undefined
  if (known) return known
  if (!item.memberRef) return undefined
  return { memberRef: item.memberRef, displayName: item.senderName || tr('群成员'), isSelf: item.isMe,
    ...(item.avatarRef ? { avatarRef: item.avatarRef } : {}), statsKnown: false }
}

type Detail = { key: string; member?: ArkmeConversationMemberItem; loading: boolean; error: string }
/** Only the open interaction reads one member; roster pagination never gates the surface. */
export function useMemberInteraction(account: string | undefined, source: ArkmeSourceItem | undefined, target: MemberActionTarget | undefined, known?: ArkmeConversationMemberItem) {
  const key = account && source && target ? JSON.stringify([account, source.sourceRef, target.memberRef]) : ''
  const [detail, setDetail] = useState<Detail>(), [revision, setRevision] = useState(0)
  const complete = known?.status === 'active' && known.statsKnown !== false
    && (source?.kind !== 'group_chat' || known.isSelf || Boolean(known.mentionRef))
  useEffect(() => {
    if (!key || !source || !target || (complete && revision === 0)) return
    const controller = new AbortController()
    setDetail(old => ({ key, ...(old?.key === key && old.member ? { member: old.member } : {}), loading: true, error: '' }))
    void callArkme<ArkmeConversationMemberPresentation>('source.members.presentation', { sourceRef: source.sourceRef, memberRefs: [target.memberRef] }, controller.signal)
      .then(page => {
        if (controller.signal.aborted) return
        validateMemberUpdate(page)
        const sameSource = source.sourceKey && page.source?.sourceKey ? source.sourceKey === page.source.sourceKey : source.sourceRef === page.source?.sourceRef
        if (page.kind !== 'presentation' || !sameSource || !Array.isArray(page.items) || !Array.isArray(page.removedMemberRefs)
          || page.items.length > 1 || page.items.some(member => member.memberRef !== target.memberRef || member.status !== 'active')) throw new Error(tr('成员资料返回异常，请重试'))
        const member = page.items[0]
        if (!member) throw new Error(tr('该成员已不属于当前会话，请刷新后重试'))
        setDetail({ key, member, loading: false, error: '' })
      }).catch(reason => { if (!controller.signal.aborted) setDetail({ key, loading: false, error: reason instanceof Error ? reason.message : tr('成员资料加载失败，请重试') }) })
    return () => controller.abort()
    // Identity keys own cancellation; object replacement during roster hydration must not restart this read.
  }, [key, revision, complete])
  const current = detail?.key === key ? detail : undefined
  const member = complete ? known : current?.member ?? known
  const value: MemberActionTarget | undefined = member && target ? { ...member,
    displayName: member.displayName && member.displayName !== tr('群成员') ? member.displayName : target.displayName,
    ...(member.avatarRef ? {} : target.avatarRef ? { avatarRef: target.avatarRef } : {}) } : target
  return { target: value, member, loading: Boolean(key && !complete && (!current || current.loading)), error: complete ? '' : current?.error ?? '', retry: () => setRevision(value => value + 1) }
}
