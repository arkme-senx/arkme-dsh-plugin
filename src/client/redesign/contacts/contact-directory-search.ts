import type { ArkmeDirectoryItem, ArkmeDirectorySectionKind } from '../../../types.js'
import { CONTACT_DIRECTORY_SECTION_ORDER, type ContactDirectoryState } from './contact-directory-state.js'

export function normalizeDirectorySearch(value: string): string {
  return value.trim().normalize('NFKC').toLocaleLowerCase()
}

function matchesDirectorySearch(item: ArkmeDirectoryItem, query: string): boolean {
  let fields: Array<string | undefined>
  switch (item.kind) {
    case 'group': fields = [item.displayName]; break
    case 'bot': fields = [item.bot.name]; break
    case 'unmarked-speaker': fields = [item.displayName, item.subtitle, item.speakerToken]; break
    case 'team': fields = [item.displayName, item.publicId]; break
    case 'contact': fields = [item.displayName, item.nickname, item.remark, item.accountName]; break
  }
  return fields.some(field => field !== undefined && normalizeDirectorySearch(field).includes(query))
}

/** A presentation-only projection: never write filtered rows or folds back to the directory cache. */
export function projectDirectorySearch(
  state: ContactDirectoryState,
  query: string,
  expanded: Partial<Record<ArkmeDirectorySectionKind, boolean>>,
): { state: ContactDirectoryState; countLabels: Partial<Record<ArkmeDirectorySectionKind, string>>; status: string | undefined } {
  if (query === '') return { state, countLabels: {}, status: undefined }
  const sections = { ...state.sections }
  const countLabels: Partial<Record<ArkmeDirectorySectionKind, string>> = {}
  let loading = false
  let incomplete = false
  let total = 0
  for (const kind of CONTACT_DIRECTORY_SECTION_ORDER) {
    const original = state.sections[kind]
    const items = original.items.filter(item => matchesDirectorySearch(item, query))
    const pending = original.status === 'idle' || original.status === 'loading'
      || (original.status !== 'error' && original.hasMore && original.nextCursor !== undefined)
    const failed = original.status === 'error' || (!pending && (original.hasMore
      || original.total > original.items.length || original.warning !== undefined))
    if (pending || failed) countLabels[kind] = '…'
    loading ||= pending
    incomplete ||= failed
    total += items.length
    sections[kind] = {
      ...original,
      items,
      total: items.length,
      expanded: expanded[kind] ?? (items.length > 0 || pending || failed),
      status: pending ? 'loading' : failed ? 'error' : items.length > 0 ? 'ready' : 'empty',
      warning: failed ? original.warning ?? '部分项目未能加载，搜索结果不完整' : undefined,
      hasMore: false,
      nextCursor: undefined,
    }
  }
  return {
    state: { ...state, sections }, countLabels,
    status: loading ? '正在搜索…' : incomplete ? '部分板块搜索未完成' : total === 0 ? '未找到匹配的项目' : undefined,
  }
}
