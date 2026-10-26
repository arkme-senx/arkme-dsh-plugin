/** Source/content hints only; annotation updates must not reread message bodies. */
const listeners = new Set<(sourceKey?: string) => void>()
export function invalidateMessageQuoteSources(sourceKey?: string) { for (const listener of listeners) listener(sourceKey) }
export function subscribeMessageQuoteInvalidations(listener: (sourceKey?: string) => void) { listeners.add(listener); return () => { listeners.delete(listener) } }
