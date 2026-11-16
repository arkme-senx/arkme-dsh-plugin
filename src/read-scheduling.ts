export const readPriorityHeader = 'X-Arkme-Read-Priority'

// Explicit reads only. A scheduling hint can never queue, coalesce or replay a
// mutation (including opening a Team conversation), nor an unknown operation.
const backgroundReadOperations = new Set([
  'record.thoughts.query', 'chat.thoughts.query', 'source.ai-polish.settings',
  'recordings.totals.index', 'recordings.totals.bucket', 'recordings.totals.day',
  'recordings.day.overview',
  'arrangements.reminders.list', 'world.interactions.summary', 'world.mine', 'world.notification-sources', 'world.comment-notifications',
  'world.interactions.list', 'world.replies', 'ai-letter.unread', 'ai-letter.list',
  'official-notifications.summary', 'official-notifications.list',
  'private-interaction.directory', 'private-interaction.summary', 'image.read', 'team.app.image', 'team.app.attention',
  'provider.capabilities', 'settings.background-sound.get', 'team.app.snapshot.capabilities',
  'calendar.buckets', 'calendar.chat-statistics', 'group.bots', 'bots.list',
  'team.app.conversations', 'team.app.read-states', 'team.app.official.membership',
  'team.app.receipt-summaries', 'team.app.people.remarks', 'user.profile', 'user.profile.refresh',
  'team.messages.mention-candidates', 'arrangements.conversation.recognition.get',
])
export function supportsBackgroundRead(operation: string, params?: Record<string, unknown>): boolean {
  if (operation === 'team.app.entries.list' || operation === 'team.app.entries.query') return params?.background === true
  if (operation === 'team.app.workspace.request') return (params?.request as { operation?: string } | undefined)?.operation === 'folders'
  if (operation === 'recordings.workflow') return params?.operation === 'query'
  if (operation === 'world.subscriptions' || operation === 'world.reactions') return params?.action === 'notifications'
  if (operation === 'reactions') return params?.action === 'notifications'
    || params?.action === 'query' && params.readPriority === undefined
  return backgroundReadOperations.has(operation)
}
