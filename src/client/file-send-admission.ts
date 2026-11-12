import { useSyncExternalStore } from 'react'
import type { ArkmeFilePolicy, ArkmeFileSendTask } from '../file-transfer-contract.js'
import { ArkmeClientError, callArkme } from './api.js'
import { withArkmeReadDeadline } from './read-deadline.js'

let filePolicy: { accountKey: string; result: Promise<ArkmeFilePolicy | undefined> } | undefined

export function fileSendPolicy(accountKey: string): Promise<ArkmeFilePolicy | undefined> {
  if (filePolicy?.accountKey === accountKey) return filePolicy.result
  const result = withArkmeReadDeadline(signal => callArkme<ArkmeFilePolicy>('files.capabilities', undefined, signal)).catch(caught => {
    if (caught instanceof ArkmeClientError
      && (caught.body.code === 'operation-unknown' || caught.body.code === 'file-flow-unavailable')) return undefined
    if (filePolicy?.result === result) filePolicy = undefined
    throw caught
  })
  filePolicy = { accountKey, result }
  return result
}

export function resetFileSendPolicy(accountKey: string | undefined): void {
  if (filePolicy?.accountKey !== accountKey) filePolicy = undefined
}

interface Admission {
  scope: string
  params: Record<string, unknown>
  task: ArkmeFileSendTask
}

const prefix = 'arkme.file-send-admission.v1:'
const listeners = new Set<() => void>()
let entries: readonly Admission[] = []

function read(key: string, raw: string | null): Admission | undefined {
  try {
    const entry = JSON.parse(raw ?? 'null') as Admission | null
    if (typeof entry?.scope === 'string' && entry.task?.taskRef === key.slice(prefix.length)
      && typeof entry.task.recordUid === 'string' && entry.task.recordUid === entry.params?.recordUid) return entry
  } catch { /* A malformed journal cannot supply a retry. */ }
  return undefined
}

function publish(next: readonly Admission[]): void {
  entries = next
  for (const listener of listeners) listener()
}

function onStorage(event: StorageEvent): void {
  if (!event.key?.startsWith(prefix)) return
  const ref = event.key.slice(prefix.length)
  const next = entries.filter(entry => entry.task.taskRef !== ref)
  const added = read(event.key, event.newValue)
  publish(added && next.length < 100 ? [...next, added] : next)
}

const snapshot = () => entries
const subscribe = (listener: () => void) => {
  if (listeners.size === 0 && typeof window !== 'undefined') {
    window.addEventListener?.('storage', onStorage)
    try {
      if (typeof localStorage !== 'undefined') {
        const restored: Admission[] = []
        for (let i = 0; i < localStorage.length && restored.length < 100; i++) {
          const key = localStorage.key(i)
          if (!key?.startsWith(prefix)) continue
          const entry = read(key, localStorage.getItem(key))
          if (entry) restored.push(entry)
        }
        entries = restored
      }
    } catch { /* Existing in-memory intents remain available. */ }
  }
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
    if (listeners.size === 0 && typeof window !== 'undefined') window.removeEventListener?.('storage', onStorage)
  }
}

export const useFileSendAdmissions = () => useSyncExternalStore(subscribe, snapshot, snapshot)

/** Preserve the exact request until the Host acknowledges it; never resend from the journal automatically. */
export function rememberFileSendAdmission(scope: string, params: Record<string, unknown>, task: ArkmeFileSendTask) {
  const remaining = entries.filter(entry => entry.task.taskRef !== task.taskRef)
  if (remaining.length >= 100) throw new Error('待确认的发送过多，请先处理原消息')
  const entry = { scope, params, task }
  if (typeof localStorage !== 'undefined') localStorage.setItem(prefix + task.taskRef, JSON.stringify(entry))
  publish([...remaining, entry])
}

export function forgetFileSendAdmissions(scope: string, recordUids: ReadonlySet<string>) {
  const next = entries.filter(entry => {
    if (entry.scope !== scope || !recordUids.has(entry.task.recordUid)) return true
    try { if (typeof localStorage !== 'undefined') localStorage.removeItem(prefix + entry.task.taskRef) }
    catch { /* Remove the acknowledged entry from the active view. */ }
    return false
  })
  if (next.length !== entries.length) publish(next)
}

export async function retryFileSendAdmission(entry: Admission, accountKey: string): Promise<ArkmeFileSendTask> {
  const policy = await fileSendPolicy(accountKey)
  if (policy?.admissionRecoveryVersion !== 1) throw new Error('当前插件无法安全核对原消息，请更新插件后重试')
  return await callArkme<ArkmeFileSendTask>('files.send', { ...entry.params, recoverAdmission: true })
}
