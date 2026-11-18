import { conversationActivityAtMillis } from './conversation-directory-order.js'
import { conversationDirectoryStyles, conversationTimeLabel } from './conversation-directory-presentation.js'
import { useConversationCivilDay } from './ArkmeConversationDate.js'
import { useArkmeLocale } from './locale.js'

export function ConversationDirectoryTime({ atMillis }: { atMillis?: number | undefined }) {
  useArkmeLocale()
  useConversationCivilDay()
  const at = conversationActivityAtMillis(atMillis)
  if (!at) return null
  return <time style={conversationDirectoryStyles.chatTime} dateTime={new Date(at).toISOString()}>{conversationTimeLabel(at)}</time>
}
