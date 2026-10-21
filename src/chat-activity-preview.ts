import { arkmeEmojiTokenSafePrefix } from './arkme-emoji-text.js'
import type { ArkmeSourceItem } from './types.js'

const object = (value: unknown): Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
const text = (value: unknown): string => typeof value === 'string' ? value.trim() : ''
const positive = (value: unknown): number => typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : 0

/** Chat selects the latest activity; admission hints and the roster are not display facts. */
export function arkmeChatActivityPreview(bundle: Record<string, unknown>, viewerUserId: number): Pick<ArkmeSourceItem, 'latestPreview' | 'latestActivityAtMillis' | 'latestActivityKind'> {
  const activity = object(bundle.latest_activity)
  const at = positive(activity.activity_at)
  if (!at || !text(activity.activity_uid) || (activity.kind !== 1 && activity.kind !== 2)) return {}
  if (activity.kind === 2) return { latestActivityAtMillis: at, latestActivityKind: 'record' }
  const joined = object(activity.member_joined)
  const actorId = positive(joined.actor_user_id), memberId = positive(joined.member_user_id)
  if (!actorId || !memberId) return {}
  const source = text(joined.join_source).toLowerCase()
  const selfJoin = actorId === memberId && ['membership_page', 'official_community', 'dsh_beta_community'].includes(source)
  const keepNickname = selfJoin && source !== 'membership_page'
  const name = (value: unknown, id: number, useYou: boolean): string => {
    if (useYou && viewerUserId > 0 && viewerUserId === id) return '你'
    const snapshot = text(value)
    return snapshot && snapshot !== String(id) && snapshot !== '用户' && snapshot !== '即我' ? snapshot : ''
  }
  const actor = name(joined.actor_display_name_snapshot, actorId, true)
  const member = name(joined.member_display_name_snapshot, memberId, !keepNickname)
  const preview = selfJoin ? member && `${member} 加入了群聊`
    : actor && member && `${actor} ${source === 'direct_add' ? '添加' : '邀请'} ${member} 加入群聊`
  return { latestActivityAtMillis: at, latestActivityKind: 'member_joined', ...(preview ? { latestPreview: arkmeEmojiTokenSafePrefix(preview, 300) } : {}) }
}

/** Member activities do not advance message sequence. Keep their freshness separate. */
export function retainNewerArkmeChatActivity(previous: ArkmeSourceItem | undefined, incoming: ArkmeSourceItem): ArkmeSourceItem {
  if (!previous?.latestActivityAtMillis) return incoming
  // Record lifecycle snapshots may intentionally select an earlier surviving message.
  if (previous.latestActivityKind === 'record' && incoming.latestActivityKind === 'record') return incoming
  const before = Math.max(previous.latestPreviewUpdatedAtMillis ?? 0, previous.latestActivityAtMillis)
  const after = Math.max(incoming.latestPreviewUpdatedAtMillis ?? 0, incoming.latestActivityAtMillis ?? 0)
  const stale = after > 0
    ? after < before || after === before && previous.latestActivityKind === 'record' && incoming.latestActivityKind === 'member_joined'
    : (incoming.latestSequence ?? 0) <= (previous.latestSequence ?? 0)
  if (!stale) return incoming
  const result: ArkmeSourceItem = { ...incoming, latestActivityAtMillis: previous.latestActivityAtMillis,
    ...(previous.latestPreviewUpdatedAtMillis === undefined ? {} : { latestPreviewUpdatedAtMillis: previous.latestPreviewUpdatedAtMillis }),
    ...(previous.latestActivityKind === undefined ? {} : { latestActivityKind: previous.latestActivityKind }),
    activeAtMillis: Math.max(previous.activeAtMillis, incoming.activeAtMillis) }
  if (previous.latestPreview === undefined) delete result.latestPreview
  else result.latestPreview = previous.latestPreview
  return result
}
