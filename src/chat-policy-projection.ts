import type { ArkmeSourceItem } from './types.js'
import { projectArkmeChatAttentionFromMuted } from './chat-attention.js'

/** A pin-only event does not provide notification evidence, even for the same policy row. */
export function retainNewerArkmeChatPolicy(
  current: ArkmeSourceItem | undefined,
  incoming: ArkmeSourceItem,
): ArkmeSourceItem {
  if ((incoming.kind !== 'private_chat' && incoming.kind !== 'group_chat')
    || current?.kind !== incoming.kind) return incoming
  let projected = incoming
  if (current.isPinned !== undefined && current.chatPolicyUpdatedAtMillis !== undefined
    && current.chatPolicyUpdatedAtMillis > (incoming.chatPolicyUpdatedAtMillis ?? 0)) {
    projected = { ...projected, isPinned: current.isPinned, chatPolicyUpdatedAtMillis: current.chatPolicyUpdatedAtMillis }
  }
  if (current.isMuted !== undefined && current.chatNotificationPolicyUpdatedAtMillis !== undefined
    && current.chatNotificationPolicyUpdatedAtMillis > (incoming.chatNotificationPolicyUpdatedAtMillis ?? 0)) {
    projected = {
      ...projected,
      ...projectArkmeChatAttentionFromMuted(incoming.unreadCount, current.isMuted),
      chatNotificationPolicyUpdatedAtMillis: current.chatNotificationPolicyUpdatedAtMillis,
    }
  }
  return projected
}
