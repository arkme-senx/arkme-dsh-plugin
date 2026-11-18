import type { ArkmeDirectoryItem, ArkmeDirectoryPage } from '../types.js'
import { callArkme } from './api.js'
import { arkmeAuthStore } from './auth-store.js'
import { identityShareAccountScope } from './identity-share-ui.js'
import { ResourceStore, resourceCancelled } from './resource-store.js'
import { tr } from './locale.js'

type Contact = Extract<ArkmeDirectoryItem, { kind: 'contact' }>
interface ContactPage { items: Contact[]; hasMore: boolean; nextCursor?: string; cursors: string[] }

function current(account: string, signal: AbortSignal): void {
  signal.throwIfAborted()
  if (!account || account !== identityShareAccountScope()) throw resourceCancelled()
}

async function readPage(account: string, signal: AbortSignal, cursor?: string): Promise<ArkmeDirectoryPage> {
  current(account, signal)
  const page = await callArkme<ArkmeDirectoryPage>('directory.list', { section: 'contacts', limit: 50, ...(cursor ? { cursor } : {}) }, signal)
  current(account, signal)
  if (!page || !Array.isArray(page.items) || typeof page.hasMore !== 'boolean'
    || page.items.some(item => item.kind !== 'contact' || !item.contactRef || typeof item.displayName !== 'string')) throw new Error(tr('目录返回异常，请重试'))
  if (page.hasMore && (!page.nextCursor || page.nextCursor === cursor)) throw new Error(tr('联系人分页异常，请重试'))
  return page
}

function firstPage(page: ArkmeDirectoryPage): ContactPage {
  return { items: page.items as Contact[], hasMore: page.hasMore, cursors: [], ...(page.nextCursor ? { nextCursor: page.nextCursor } : {}) }
}

/** One account-scoped display snapshot survives closing the picker. Opaque refs stay in memory. */
export const teamOutboundContacts = new ResourceStore<ContactPage, string>({
  freshForMs: 30_000,
  async load(account, signal) { return firstPage(await readPage(account, signal)) },
}, Date.now, 8)

let observingAccount = false
export function observeTeamOutboundAccount(): void {
  if (observingAccount) return
  observingAccount = true
  let account = identityShareAccountScope()
  arkmeAuthStore.subscribe(() => {
    const next = identityShareAccountScope()
    if (account !== next) { account = next; teamOutboundContacts.reset() }
  })
}

export async function loadMoreTeamOutboundContacts(account: string): Promise<void> {
  await teamOutboundContacts.mutate(account, account, async context => {
    const previous = context.value()
    if (!previous?.hasMore || !previous.nextCursor) return
    const page = await readPage(account, context.signal, previous.nextCursor)
    // A Host snapshot can expire while the picker stays open. Restart with one coherent page.
    if (page.cursorStale) { await context.read(); return }
    if (page.nextCursor && previous.cursors.includes(page.nextCursor)) throw new Error(tr('联系人分页异常，请重试'))
    context.commit({ items: [...new Map([...previous.items, ...page.items as Contact[]].map(item => [item.contactRef, item])).values()],
      hasMore: page.hasMore, cursors: [...previous.cursors, previous.nextCursor], ...(page.nextCursor ? { nextCursor: page.nextCursor } : {}) })
  })
}
