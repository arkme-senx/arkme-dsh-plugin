import { conversationActivityAtMillis } from './conversation-directory-order.js'
import { conversationDirectoryStyles, conversationTimeLabel } from './conversation-directory-presentation.js'

export function ConversationDirectoryTime({ atMillis }: { atMillis?: number | undefined }) {
  const at = conversationActivityAtMillis(atMillis)
  if (!at) return null
  return <time style={conversationDirectoryStyles.chatTime} dateTime={new Date(at).toISOString()}>{conversationTimeLabel(at)}</time>
}
