import type { ArkmeArkoLifecycleCommand, ArkmeArkoLifecycleItem, ArkmeArkoLifecycleResult, ArkmeArkoLifecycleSnapshot } from '../arko-lifecycle-contract.js'
import { callArkme } from './api.js'

const applied = (result: string) => ['applied', 'already_applied', 'already_deleted', 'already_active'].includes(result)
const desired = (action: ArkmeArkoLifecycleCommand['action'], item: ArkmeArkoLifecycleItem) => action === 'restore'
  ? item.state === 'active' : item.state === 'deleted' || item.state === 'expired'

/** One explicit intent. Uncertain writes are only read back; their operation
 * identity and expected versions never advance on repeated confirmation. */
export function arkoLifecycleOperation(command: ArkmeArkoLifecycleCommand) {
  let pending: ArkmeArkoLifecycleCommand['targets'] = []
  return async (signal: AbortSignal): Promise<{ items: ArkmeArkoLifecycleItem[]; complete: boolean }> => {
    if (pending.length) {
      const snapshot = await callArkme<ArkmeArkoLifecycleSnapshot>('arko.lifecycle.query', {
        messageRefs: command.targets.map(item => item.messageRef),
      }, signal)
      signal.throwIfAborted()
      const items = snapshot.items
      pending = pending.filter(target => {
        const fact = items.find(item => item.messageRef === target.messageRef)
        return !fact || (fact.state !== 'unavailable' && fact.version <= target.expectedVersion)
      })
      return { items, complete: !pending.length && items.length === command.targets.length && items.every(item => desired(command.action, item)) }
    }
    pending = command.targets
    const result = await callArkme<ArkmeArkoLifecycleResult>('arko.lifecycle.change', command as unknown as Record<string, unknown>, signal)
    signal.throwIfAborted()
    pending = command.targets.filter(target => {
      const item = result.items.find(item => item.messageRef === target.messageRef)
      return !item || item.result === 'unknown'
    })
    return { items: result.items, complete: !pending.length && result.items.length === command.targets.length
      && result.items.every(item => applied(item.result) && desired(command.action, item)) }
  }
}
