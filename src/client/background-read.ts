import { ArkmeRequestCoordinator } from '../request-coordinator.js'

// This budget is only for optional built-in UI reads before they reach fetch.
// Host owns upstream rate limiting; local cached responses must not be throttled.
const concurrencyOnly = { ratePerSecond: Number.MAX_SAFE_INTEGER, burst: Number.MAX_SAFE_INTEGER, maxQueued: 512 }
export const backgroundUiReads = new ArkmeRequestCoordinator({
  laneLimits: { 'background-read': { ...concurrencyOnly, maxConcurrent: 2 } },
  defaultServiceLimit: { ...concurrencyOnly, maxConcurrent: 2 },
})

// Explicit reads only. A scheduling hint can never queue, coalesce or replay a
// mutation (including opening a Team conversation), nor an unknown operation.
const backgroundReadOperations = new Set([
  'arrangements.reminders.list', 'world.interactions.summary', 'world.mine',
  'world.interactions.list', 'ai-letter.unread', 'ai-letter.list',
  'official-notifications.summary', 'official-notifications.list',
  'private-interaction.directory', 'image.read', 'team.app.image', 'team.app.attention',
])
export function supportsBackgroundRead(operation: string): boolean {
  return backgroundReadOperations.has(operation)
}
