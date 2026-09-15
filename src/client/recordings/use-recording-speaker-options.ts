import { useMemo, useSyncExternalStore } from 'react'
import type { ArkmeRecordingSpeakerOption, ArkmeRecordingWorkbenchItem } from '../../types.js'
import { arkmeAuthStore } from '../auth-store.js'
import { useResource } from '../use-resource.js'
import { assignRecordingSpeaker, recordingSpeakerAccount, recordingSpeakerOptions, recordingSpeakerItemContexts } from './recording-speaker-options-store.js'

export type RecordingSpeakerChoice = { optionKey: string; newSpeakerName?: never } | { newSpeakerName: string; optionKey?: never }

export function useRecordingSpeakerOptions(item: ArkmeRecordingWorkbenchItem) {
  const auth = useSyncExternalStore(arkmeAuthStore.subscribe, arkmeAuthStore.getSnapshot, arkmeAuthStore.getSnapshot)
  const account = recordingSpeakerAccount(auth.auth)
  const binding = useMemo(() => ({ account, itemRef: item.itemRef }), [account, item.itemRef])
  const key = account === undefined ? undefined : JSON.stringify([account, item.itemRef])
  const directory = useResource(recordingSpeakerOptions, account, account)
  const itemContext = useResource(recordingSpeakerItemContexts, key, binding)
  const options = useMemo<ArkmeRecordingSpeakerOption[]>(() => (directory.snapshot.value ?? []).map(candidate => ({
    ...candidate,
    currentAssignment: candidate.optionKey === item.assignedSpeakerOptionKey,
    recommended: candidate.optionKey === itemContext.snapshot.value?.optionKey,
  })), [directory.snapshot.value, item.assignedSpeakerOptionKey, itemContext.snapshot.value])
  const error = directory.snapshot.error === undefined ? ''
    : directory.snapshot.error instanceof Error ? directory.snapshot.error.message : '说话人候选读取失败'
  const ready = account !== undefined && directory.snapshot.value !== undefined && !directory.snapshot.stale && error === ''
  const save = async (scope: 'item' | 'speaker', choice: RecordingSpeakerChoice) => {
    if (key === undefined || account === undefined) return undefined
    const current = recordingSpeakerOptions.get(account)
    if (current.value === undefined || current.stale || current.error !== undefined) return undefined
    if (choice.optionKey === undefined) {
      return await assignRecordingSpeaker(key, binding, { scope, newSpeakerName: choice.newSpeakerName })
    }
    const candidate = current.value.find(option => option.optionKey === choice.optionKey)
    if (candidate === undefined) return undefined
    return await assignRecordingSpeaker(key, binding, { scope, speakerRef: candidate.speakerRef })
  }
  return {
    contextKey: key, options, ready, error, save,
    pending: itemContext.snapshot.mutating,
    loading: directory.snapshot.value === undefined && directory.snapshot.error === undefined,
    refresh: directory.refresh,
  }
}
