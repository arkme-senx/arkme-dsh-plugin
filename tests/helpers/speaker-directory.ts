import { vi } from 'vitest'
import type { SpeakerDirectoryPage, SpeakerDirectoryPerson, SpeakerDirectorySummary } from '../../src/speaker-directory-contract.js'
import type { DirectoryLoaders } from '../../src/client/recognized-speaker-directory.js'
export const directoryStatus = { state: 'fresh' as const, coverage: 'complete' as const, retryAfterMs: 0, processingSessionCount: 0, pendingIdentityAggregationCount: 0, insufficientEvidenceCount: 0, scanTruncated: false }
export const summary = (patch: Partial<SpeakerDirectorySummary> = {}): SpeakerDirectorySummary => ({ ...directoryStatus, totalCount: 43, markedCount: 10, unmarkedCount: 33, unseenCount: 3, snapshotVersion: 'v1', seenVersion: 1, updatedAt: 1, notModified: false, ...patch })
export const person = (key: string, patch: Partial<SpeakerDirectoryPerson> = {}): SpeakerDirectoryPerson => ({ personKey: key, type: 'unmarked', displayName: `说话人 ${key}`, displayNumber: Number(key) || 0, isSelf: false, dayCount: 3, lastSeenAt: 1790640000000, detailRef: `detail-${key}`, ...patch })
export const page = (patch: Partial<SpeakerDirectoryPage> = {}): SpeakerDirectoryPage => ({ ...directoryStatus, items: [person('1')], hasMore: false, nextCursor: '', snapshotVersion: 'v1', throughCursor: 'seen-v1', ...patch })
export const loaders = (patch: Partial<DirectoryLoaders> = {}): DirectoryLoaders => ({
  summary: vi.fn(async () => summary()), list: vi.fn(async () => page()), seen: vi.fn(async () => ({ success: true, seenVersion: 2 })),
  open: vi.fn(async () => ({ type: 'speaker', speakerRef: 'speaker-ref', expectedVersion: 'presence-v1' })),
  avatars: vi.fn(async detailRefs => detailRefs.map(detailRef => ({ detailRef }))), ...patch,
})
export const query = { filter: 'all' as const, sort: 'frequent' as const, query: '' }
export function deferred<T>() { let resolve!: (value: T) => void; let reject!: (error: unknown) => void; const promise = new Promise<T>((ok, fail) => { resolve = ok; reject = fail }); return { promise, resolve, reject } }
