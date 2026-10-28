import type { ArkmeRecordSearchResult, ArkmeSearchRecordItem } from '../types.js'

export const articleIdentity = (item: ArkmeSearchRecordItem) => `${String(item.recordOwnerUserId ?? '')}:${item.recordUid}`
export const articleSourceMatches = (item: ArkmeSearchRecordItem, sourceKey?: string) => sourceKey === undefined
  || item.targetSource?.sourceKey === sourceKey || item.targetSource?.sourceRef === sourceKey

/** Retain the user's loaded window. Revalidation replaces one page, never the window. */
export class LongArticlePages {
  private pages: { cursor: string | undefined; result: ArkmeRecordSearchResult }[] = []
  constructor(initial?: ArkmeRecordSearchResult) { if (initial) this.put(undefined, initial) }
  put(cursor: string | undefined, result: ArkmeRecordSearchResult) {
    const index = this.pages.findIndex(page => page.cursor === cursor)
    if (index < 0) this.pages.push({ cursor, result })
    else this.pages[index] = { cursor, result }
  }
  cursors(sourceKey?: string) {
    return this.pages.filter(page => sourceKey === undefined || page.result.items.some(item => articleSourceMatches(item, sourceKey))).map(page => page.cursor)
  }
  mapItems(change: (items: ArkmeSearchRecordItem[]) => ArkmeSearchRecordItem[]) {
    for (const page of this.pages) page.result = { ...page.result, items: change(page.result.items) }
  }
  snapshot(created?: ArkmeSearchRecordItem): ArkmeRecordSearchResult | undefined {
    const last = this.pages.at(-1)?.result
    if (!last) return undefined
    return { ...last, items: [...new Map([
      ...(created ? [created] : []), ...this.pages.flatMap(page => page.result.items),
    ].map(item => [articleIdentity(item), item])).values()] }
  }
}
