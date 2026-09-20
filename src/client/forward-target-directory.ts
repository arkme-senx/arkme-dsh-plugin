import { useEffect, useState } from 'react'
import type { ArkmeSourceItem } from '../types.js'
import { callArkme } from './api.js'
import { arkmeAuthStore } from './auth-store.js'
import { arkmeChatDirectory } from './chat-directory-store.js'

export interface ForwardTargetDirectorySnapshot {
  chats: readonly ArkmeSourceItem[]
  self: ArkmeSourceItem | undefined
  loading: boolean
  error: string
}

export interface ForwardTargetDirectoryPort {
  snapshot(account: string): ForwardTargetDirectorySnapshot
  observe(account: string, publish: (snapshot: ForwardTargetDirectorySnapshot) => void): () => void
}

export const forwardTargetDirectory: ForwardTargetDirectoryPort = {
  snapshot(account) {
    const directory = arkmeChatDirectory.getSnapshot()
    const matches = arkmeChatDirectory.getConversationSnapshot().accountScope === account
    return { chats: matches ? directory.sources : [], self: matches ? directory.projection?.sendToSelf : undefined, loading: true, error: '' }
  },
  observe(account, publish) {
    const controller = new AbortController()
    let self = this.snapshot(account).self
    let loading = true
    let error = ''
    const current = () => {
      const auth = arkmeAuthStore.getSnapshot().auth
      return !controller.signal.aborted && auth?.status === 'authenticated' && `${auth.environment}:${auth.userId}` === account
    }
    const emit = () => {
      if (!current()) return
      const snapshot = this.snapshot(account)
      publish({ ...snapshot, self: self ?? snapshot.self, loading, error })
    }
    const unsubscribe = arkmeChatDirectory.subscribe(emit)
    emit()
    const chats = arkmeChatDirectory.refreshRoot({ silent: true }).catch(() => {
      error = '会话列表刷新失败，请稍后重试'
      emit()
    })
    const personal = callArkme<ArkmeSourceItem>('sources.self-target', {}, controller.signal).then(target => {
      self = target
      emit()
    }).catch(() => {
      error = '发给自己加载失败，请稍后重试'
      emit()
    })
    void Promise.allSettled([chats, personal]).then(() => { loading = false; emit() })
    return () => { controller.abort(); unsubscribe() }
  },
}

const EMPTY: ForwardTargetDirectorySnapshot = { chats: [], self: undefined, loading: false, error: '' }

export function useForwardTargetDirectory(account: string | undefined, enabled: boolean) {
  const [state, setState] = useState<{ account: string; snapshot: ForwardTargetDirectorySnapshot }>()
  useEffect(() => {
    if (!enabled || account === undefined) { setState(undefined); return }
    return forwardTargetDirectory.observe(account, snapshot => setState({ account, snapshot }))
  }, [account, enabled])
  if (!enabled || account === undefined) return EMPTY
  return state?.account === account ? state.snapshot : forwardTargetDirectory.snapshot(account)
}
