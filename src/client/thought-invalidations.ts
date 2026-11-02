type Change = { accountScope: string; sourceKey?: string; timelineItemKey?: string; clear?: boolean; stream?: import('../record-thought-contract.js').ArkmeThoughtStreamUpdate }
const listeners = new Set<(change: Change) => void>()
export function publishThoughtInvalidation(change: Change): void { for (const listener of listeners) listener(change) }
export function subscribeThoughtInvalidation(listener: (change: Change) => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}
