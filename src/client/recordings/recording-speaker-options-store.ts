import type { ArkmeAuthSnapshot, ArkmeRecordingSpeakerMutationResult, ArkmeRecordingSpeakerCandidate, ArkmeRecordingSpeakerRecommendation } from '../../types.js'
import { callArkme } from '../api.js'
import { arkmeAuthStore } from '../auth-store.js'
import { ResourceStore, resourceCancelled } from '../resource-store.js'

export function recordingSpeakerAccount(auth: ArkmeAuthSnapshot | undefined): string | undefined {
  return auth?.status === 'authenticated' && auth.userId !== undefined
    ? `${auth.environment}:${auth.userId}` : undefined
}

export interface RecordingSpeakerItemBinding { account: string | undefined; itemRef: string }

function currentAccount(account: string | undefined, signal?: AbortSignal): boolean {
  return account !== undefined && account === recordingSpeakerAccount(arkmeAuthStore.getSnapshot().auth) && !signal?.aborted
}

export const recordingSpeakerOptions = new ResourceStore<ArkmeRecordingSpeakerCandidate[], string | undefined>({
  loadCached: async (account, signal) => {
    if (!currentAccount(account, signal)) throw resourceCancelled()
    const options = await callArkme<ArkmeRecordingSpeakerCandidate[] | null>('recordings.speaker.cached-options', {}, signal)
    if (!currentAccount(account, signal)) throw resourceCancelled()
    return options ?? undefined
  },
  load: async (account, signal) => {
    if (!currentAccount(account, signal)) throw resourceCancelled()
    const options = await callArkme<ArkmeRecordingSpeakerCandidate[]>('recordings.speaker.options', {}, signal)
    if (!currentAccount(account, signal)) throw resourceCancelled()
    return options
  },
})

// Each editable item owns its optional recommendation and assignment concurrency.
export const recordingSpeakerItemContexts = new ResourceStore<ArkmeRecordingSpeakerRecommendation, RecordingSpeakerItemBinding>({
  load: async (binding, signal) => {
    if (!currentAccount(binding.account, signal)) throw resourceCancelled()
    const recommendation = await callArkme<ArkmeRecordingSpeakerRecommendation>(
      'recordings.speaker.recommendation', { itemRef: binding.itemRef }, signal,
    )
    if (!currentAccount(binding.account, signal)) throw resourceCancelled()
    return recommendation
  },
}, Date.now, 50)

export function resetRecordingSpeakerCaches(): void {
  recordingSpeakerOptions.reset()
  recordingSpeakerItemContexts.reset()
  recordingSpeakerOptions.invalidate()
  recordingSpeakerItemContexts.invalidate()
}

let account = recordingSpeakerAccount(arkmeAuthStore.getSnapshot().auth)
arkmeAuthStore.subscribe(() => {
  const next = recordingSpeakerAccount(arkmeAuthStore.getSnapshot().auth)
  if (account === next) return
  account = next
  resetRecordingSpeakerCaches()
})

export async function assignRecordingSpeaker(
  key: string,
  binding: RecordingSpeakerItemBinding,
  input: { scope: 'item' | 'speaker'; speakerRef?: string; newSpeakerName?: string },
): Promise<ArkmeRecordingSpeakerMutationResult | undefined> {
  return await recordingSpeakerItemContexts.mutate(key, binding, async context => {
    try {
      if (!currentAccount(binding.account)) throw resourceCancelled()
      const value = await callArkme<ArkmeRecordingSpeakerMutationResult>(
        'recordings.speaker.assign-item', { itemRef: binding.itemRef, ...input }, context.signal,
      )
      if (!context.current()) return undefined
      return value
    } catch (error) {
      if (!context.current()) return undefined
      throw error
    } finally {
      if (context.current()) {
        // A failed command may already have created a speaker. Reconcile reads; never retry the write.
        recordingSpeakerOptions.reset()
        recordingSpeakerOptions.invalidate()
        recordingSpeakerItemContexts.reset(candidateKey => candidateKey === key || !recordingSpeakerItemContexts.get(candidateKey).mutating)
        recordingSpeakerItemContexts.invalidate()
      }
    }
  })
}
