import type { ArkmeDeletedRecord, ArkmeDeletedRecordPage } from '../data-management.js'
import type { ArkmeArkoDeletedPage } from '../arko-lifecycle-contract.js'
import { callArkme } from './api.js'
import { arkoLifecycleOperation } from './arko-lifecycle-operation.js'
import { arkoLifecycleSync } from './arko-lifecycle-sync.js'
import { arkmeUi } from './ui-controller.js'

/** Presentation is shared; the discriminated owner keeps Arko identities out of Record APIs. */
export type DeletedItem = {
  key: string; title: string; text: string; sendAtMillis: number; version: number
  recoverableUntilMillis?: number
} & ({ owner: 'record'; record: ArkmeDeletedRecord } | { owner: 'arko'; messageRef: string })
export type DeletedItemsPage = Omit<ArkmeDeletedRecordPage, 'items'> & { items: DeletedItem[] }

export async function readDeletedItems(scope: string, signal: AbortSignal): Promise<DeletedItemsPage> {
  const [records, messages] = await Promise.allSettled([
    callArkme<ArkmeDeletedRecordPage>('data.deleted', { expectedAccountScope: scope }, signal),
    callArkme<ArkmeArkoDeletedPage>('arko.deleted', {}, signal),
  ])
  signal.throwIfAborted()
  const recordPage = records.status === 'fulfilled' && records.value.accountScope === scope && Array.isArray(records.value.items) ? records.value : undefined
  const messagePage = messages.status === 'fulfilled' && Array.isArray(messages.value.items) && typeof messages.value.hasMore === 'boolean' ? messages.value : undefined
  if (!recordPage && !messagePage) throw new Error('最近删除暂时无法读取，请重试或在手机端查看。')
  const items: DeletedItem[] = (recordPage?.items ?? []).map(record => ({ ...record, key: `record:${record.recordUid}`, owner: 'record', record }))
  let unverifiedCount = (recordPage?.unverifiedCount ?? 0) + Number(!recordPage) + Number(!messagePage)
  for (const item of messagePage?.items ?? []) {
    if (item.state !== 'deleted' || item.purgeAtMillis <= Date.now()) continue
    if (!item.message) { unverifiedCount++; continue }
    items.push({ key: `arko:${item.messageKey}`, owner: 'arko', messageRef: item.messageRef, version: item.version,
      title: '', text: item.message.text, sendAtMillis: item.message.createdAtMillis, recoverableUntilMillis: item.purgeAtMillis })
  }
  items.sort((a, b) => b.sendAtMillis - a.sendAtMillis || a.key.localeCompare(b.key))
  return { accountScope: scope, items, mayHaveMore: !!recordPage?.mayHaveMore || !!messagePage?.hasMore, unverifiedCount }
}

export function deletedItemRecovery(scope: string, item: DeletedItem) {
  if (item.owner === 'record') return async (signal: AbortSignal) => {
    await callArkme('data.recover', { expectedAccountScope: scope, recordUid: item.record.recordUid, version: item.version }, signal)
    signal.throwIfAborted(); arkmeUi.recordChanged(); arkmeUi.chatChanged()
  }
  const restore = arkoLifecycleOperation({ action: 'restore', operationUid: crypto.randomUUID(),
    targets: [{ messageRef: item.messageRef, expectedVersion: item.version }] })
  return async (signal: AbortSignal) => {
    if ((item.recoverableUntilMillis ?? 0) <= Date.now()) throw new Error('恢复失败，请刷新后重试')
    const result = await restore(signal)
    if (!result.complete) throw new Error('操作结果暂时无法确认，请重试')
    arkoLifecycleSync.invalidate()
  }
}
