import { useEffect, useSyncExternalStore } from 'react'
import type { ConversationRecognitionSetting } from '../conversation-recognition.js'
import { callArkme } from './api.js'
import { withArkmeReadDeadline } from './read-deadline.js'

type Snapshot = { value?: ConversationRecognitionSetting; busy: boolean; error: string }
type Entry = { state: Snapshot; listeners: Set<() => void>; read?: AbortController; write?: AbortController }
const empty: Snapshot = { busy: false, error: '' }
const entries = new Map<string, Entry>()
const keyFor = (account: string, reference: string, scope: string) => JSON.stringify([account, scope, reference])
function entryFor(key: string) {
  let entry = entries.get(key)
  if (!entry) {
    entry = { state: empty, listeners: new Set() }; entries.set(key, entry)
    for (const [oldKey, old] of entries) {
      if (entries.size <= 256) break
      if (oldKey !== key && !old.listeners.size && !old.write) { old.read?.abort(); entries.delete(oldKey) }
    }
  }
  return entry
}
function update(entry: Entry, state: Snapshot) { entry.state = state; for (const notify of entry.listeners) notify() }
const message = (error: unknown) => error instanceof Error ? error.message : '安排识别设置读取失败，请重试'

export function useConversationRecognition(account: string, reference: string, scope: 'chat' | 'team', active: boolean) {
  const key = keyFor(account, reference, scope)
  const entry = entryFor(key)
  const state = useSyncExternalStore(notify => { entry.listeners.add(notify); return () => { entry.listeners.delete(notify) } }, () => entry.state, () => empty)
  const params = { expectedAccountScope: account, ...(scope === 'team' ? { teamConversationRef: reference } : { sourceRef: reference }) }
  async function read() {
    if (!account || !reference || entry.write || entry.read) return
    const controller = new AbortController(); entry.read = controller
    update(entry, { ...entry.state, busy: !entry.state.value, error: '' })
    try {
      const value = await withArkmeReadDeadline(signal => callArkme<ConversationRecognitionSetting>('arrangements.conversation.recognition.get', params, signal), controller.signal)
      if (!value || value.accountScope !== account) throw new Error('安排识别设置响应无效，请重试')
      if (!controller.signal.aborted) update(entry, { value, busy: false, error: '' })
    } catch (error) { if (!controller.signal.aborted) update(entry, { ...entry.state, busy: false, error: message(error) }) }
    finally { if (entry.read === controller) delete entry.read }
  }
  async function toggle() {
    if (entry.write) return
    const previous = entry.state.value
    if (!previous) { await read(); return }
    entry.read?.abort(); delete entry.read
    const controller = new AbortController(); entry.write = controller
    update(entry, { ...entry.state, busy: true, error: '' })
    const desired = !previous.enabled
    try {
      const value = await callArkme<ConversationRecognitionSetting>('arrangements.conversation.recognition.set', { ...params, enabled: desired, expectedVersion: previous.version }, controller.signal)
      if (!value || value.accountScope !== account || value.enabled !== desired) throw new Error('安排识别开关未确认保存，请重试')
      update(entry, { value, busy: false, error: '' })
    } catch (error) {
      // A response may be lost after commit. Reconcile once, never blindly replay a write.
      let value = previous
      try {
        const result = await withArkmeReadDeadline(signal => callArkme<ConversationRecognitionSetting>('arrangements.conversation.recognition.get', params, signal), controller.signal)
        if (result?.accountScope === account) value = result
      } catch { /* Retain the last server-confirmed value. */ }
      update(entry, { value, busy: false, error: value.enabled === desired ? '' : message(error) })
    } finally { delete entry.write }
  }
  useEffect(() => {
    if (!active || !account || !reference) return
    void read()
    const refresh = () => { void read() }
    window.addEventListener('focus', refresh)
    const timer = window.setInterval(refresh, 60_000)
    return () => { window.removeEventListener('focus', refresh); window.clearInterval(timer) }
  }, [key, active])
  return { ...state, toggle, refresh: read }
}
