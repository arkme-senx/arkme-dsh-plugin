import { useSyncExternalStore } from 'react'
import type { RecordingFavoriteRequest, RecordingFavoriteResult } from '../recording-favorite-contract.js'
import { arkmeAuthStore } from './auth-store.js'
import { callArkme } from './api.js'

export const favoriteAccount = () => {
  const auth = arkmeAuthStore.getSnapshot().auth
  return auth?.status === 'authenticated' ? `${auth.environment}:${auth.userId}` : undefined
}
export function useFavoriteAccount() {
  const state = useSyncExternalStore(arkmeAuthStore.subscribe, arkmeAuthStore.getSnapshot, arkmeAuthStore.getSnapshot)
  return { accountKey: state.auth?.status === 'authenticated' ? `${state.auth.environment}:${state.auth.userId}` : undefined, mediaPath: state.config?.mediaPath ?? '/arkme-self/api/media' }
}
const listeners = new Set<(account: string) => void>()
export const favoriteChanges = {
  subscribe(listener: (account: string) => void) { listeners.add(listener); return () => { listeners.delete(listener) } },
  publish(account: string) { if (account === favoriteAccount()) for (const listener of listeners) listener(account) },
}
export async function recordingFavorites<T extends RecordingFavoriteRequest>(input: T & { accountKey: string }, signal?: AbortSignal): Promise<RecordingFavoriteResult<T>> {
  if (input.accountKey !== favoriteAccount()) throw new Error('账号已变化，请重新打开')
  const controller = new AbortController(), scoped = AbortSignal.any([controller.signal, ...(signal ? [signal] : [])])
  const release = arkmeAuthStore.subscribe(() => { if (input.accountKey !== favoriteAccount()) controller.abort() })
  try {
    scoped.throwIfAborted()
    const result = await callArkme<RecordingFavoriteResult<T>>('recordings.favorites', input, scoped)
    scoped.throwIfAborted()
    return result
  } finally { release() }
}
