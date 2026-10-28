import type { ArkmeArrangementItem, ArkmeArrangementMutationIntent, ArkmeArrangementMutationResult } from '../types.js'
import { callArkme } from './api.js'
import { withArkmeReadDeadline } from './read-deadline.js'

export const arrangementColumns = ['identified', 'following', 'completed'] as const
export type ArrangementColumn = typeof arrangementColumns[number]
export const arrangementColumnLabels: Record<ArrangementColumn, string> = {
  identified: '已识别', following: '跟进中', completed: '已完成',
}

/** Never replay an ambiguous write. Read its owner state before continuing a multi-step move. */
export async function moveArrangement(item: ArkmeArrangementItem, target: ArrangementColumn, signal: AbortSignal): Promise<ArkmeArrangementItem> {
  if (item.status === target) return item
  if (item.status === 'unknown') throw new Error('安排状态暂不可用，请刷新后重试')
  const intents: ArkmeArrangementMutationIntent[] = target === 'completed' ? ['complete']
    : target === 'following' ? [item.status === 'completed' ? 'cancel-complete' : 'start-follow']
      : item.status === 'completed' ? ['cancel-complete', 'cancel-follow'] : ['cancel-follow']
  let current = item
  for (const intent of intents) {
    signal.throwIfAborted()
    const result = await callArkme<ArkmeArrangementMutationResult>('arrangements.mutate', { arrangementRef: item.arrangementRef, intent }, signal)
    const expected = intent === 'complete' ? 'completed' : intent === 'cancel-follow' ? 'identified' : 'following'
    current = result.item ?? await withArkmeReadDeadline(readSignal => callArkme<ArkmeArrangementItem>('arrangements.detail', { arrangementRef: item.arrangementRef }, readSignal), signal)
    signal.throwIfAborted()
    if (current.arrangementRef !== item.arrangementRef || current.status !== expected) {
      throw new Error('安排状态未确认，请刷新后重试')
    }
  }
  return current
}
