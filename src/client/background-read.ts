import { ArkmeRequestCoordinator } from '../request-coordinator.js'

// Optional JSON reads and image downloads use separate, bounded permits.
// Host owns upstream rate limiting; local cached responses must not be throttled.
const concurrencyOnly = { ratePerSecond: Number.MAX_SAFE_INTEGER, burst: Number.MAX_SAFE_INTEGER, maxQueued: 512 }
export const backgroundUiReads = new ArkmeRequestCoordinator({
  laneLimits: {
    'background-read': { ...concurrencyOnly, maxConcurrent: 2 },
    image: { ...concurrencyOnly, maxConcurrent: 2 },
  },
  defaultServiceLimit: { ...concurrencyOnly, maxConcurrent: 2 },
})

// Explicit reads only. A scheduling hint can never queue, coalesce or replay a
// mutation (including opening a Team conversation), nor an unknown operation.
const backgroundReadOperations = new Set([
  'record.thoughts.query', 'chat.thoughts.query',
  'recordings.totals.index', 'recordings.totals.bucket', 'recordings.totals.day',
  'recordings.day.overview',
  'arrangements.reminders.list', 'world.interactions.summary', 'world.mine', 'world.notification-sources', 'world.comment-notifications',
  'world.interactions.list', 'world.replies', 'ai-letter.unread', 'ai-letter.list',
  'official-notifications.summary', 'official-notifications.list',
  'private-interaction.directory', 'image.read', 'team.app.image', 'team.app.attention',
  'provider.capabilities', 'settings.background-sound.get', 'team.app.snapshot.capabilities',
  'team.app.receipt-summaries', 'team.app.people.remarks', 'user.profile', 'user.profile.refresh',
  'team.messages.mention-candidates', 'arrangements.conversation.recognition.get',
])
export function supportsBackgroundRead(operation: string, params?: Record<string, unknown>): boolean {
  if (operation === 'recordings.workflow') return params?.operation === 'query'
  if (operation === 'world.subscriptions' || operation === 'world.reactions') return params?.action === 'notifications'
  if (operation === 'reactions') return params?.action === 'notifications'
    || params?.action === 'query' && params.readPriority === undefined
  return backgroundReadOperations.has(operation)
}
