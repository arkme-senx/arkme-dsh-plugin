import type {
  ArkmeDirectoryItem,
  ArkmeDirectoryPage,
  ArkmeDirectorySectionKind,
} from '../../../types.js'

export const CONTACT_DIRECTORY_SECTION_ORDER = [
  'groups',
  'bots',
  'unmarked-speakers',
  'teams',
  'contacts',
] as const satisfies readonly ArkmeDirectorySectionKind[]

export type ContactDirectoryLoadStatus = 'idle' | 'loading' | 'ready' | 'empty' | 'error'
export type ContactDirectoryLoadMode = 'replace' | 'append' | 'count'

export type ArkmeDirectorySelection =
  | { kind: 'none' }
  | { kind: 'contact'; contactRef: string }
  | { kind: 'unmarked-speaker'; candidateRef: string }

export interface ContactDirectorySectionState {
  section: ArkmeDirectorySectionKind
  status: ContactDirectoryLoadStatus
  items: ArkmeDirectoryItem[]
  total: number
  hasMore: boolean
  nextCursor: string | undefined
  expanded: boolean
  generation: number
  accountKey: string
  warning: string | undefined
  loadingMode: ContactDirectoryLoadMode | undefined
}

export interface ContactDirectoryState {
  accountKey: string
  selection: ArkmeDirectorySelection
  sections: Record<ArkmeDirectorySectionKind, ContactDirectorySectionState>
}

export type ContactDirectoryAction =
  | { type: 'set-expanded'; section: ArkmeDirectorySectionKind; expanded: boolean }
  | { type: 'select'; selection: ArkmeDirectorySelection }
  | { type: 'reset-account'; accountKey: string }
  | {
    type: 'load-start'
    section: ArkmeDirectorySectionKind
    accountKey: string
    generation: number
    mode: ContactDirectoryLoadMode
  }
  | {
    type: 'load-success'
    section: ArkmeDirectorySectionKind
    accountKey: string
    generation: number
    mode: ContactDirectoryLoadMode
    page: ArkmeDirectoryPage
  }
  | {
    type: 'load-error'
    section: ArkmeDirectorySectionKind
    accountKey: string
    generation: number
    message: string
  }

function createSection(
  section: ArkmeDirectorySectionKind,
  accountKey: string,
): ContactDirectorySectionState {
  return {
    section,
    status: 'idle',
    items: [],
    total: 0,
    hasMore: false,
    nextCursor: undefined,
    expanded: section === 'contacts',
    generation: 0,
    accountKey,
    warning: undefined,
    loadingMode: undefined,
  }
}

export function createContactDirectoryState(accountKey: string): ContactDirectoryState {
  return {
    accountKey,
    selection: { kind: 'none' },
    sections: {
      groups: createSection('groups', accountKey),
      bots: createSection('bots', accountKey),
      'unmarked-speakers': createSection('unmarked-speakers', accountKey),
      teams: createSection('teams', accountKey),
      contacts: createSection('contacts', accountKey),
    },
  }
}

export function directoryItemKey(item: ArkmeDirectoryItem): string {
  switch (item.kind) {
    case 'group': return `group:${item.sourceRef}`
    case 'bot': return `bot:${item.botRef}`
    case 'unmarked-speaker': return `unmarked-speaker:${item.candidateRef}`
    case 'team': return `team:${item.rowKey}`
    case 'contact': return `contact:${item.contactRef}`
  }
}

export function sectionNeedsInitialLoad(section: ContactDirectorySectionState): boolean {
  return section.status === 'idle'
}

function mergeDirectoryItems(
  current: readonly ArkmeDirectoryItem[],
  incoming: readonly ArkmeDirectoryItem[],
): ArkmeDirectoryItem[] {
  const merged = [...current]
  const indexes = new Map(merged.map((item, index) => [directoryItemKey(item), index]))
  for (const item of incoming) {
    const key = directoryItemKey(item)
    const index = indexes.get(key)
    if (index === undefined) {
      indexes.set(key, merged.length)
      merged.push(item)
    } else {
      merged[index] = item
    }
  }
  return merged
}

function completionMatches(
  state: ContactDirectoryState,
  section: ArkmeDirectorySectionKind,
  accountKey: string,
  generation: number,
): boolean {
  const current = state.sections[section]
  return state.accountKey === accountKey
    && current.accountKey === accountKey
    && current.section === section
    && current.generation === generation
}

function selectionAfterReplacement(
  selection: ArkmeDirectorySelection,
  section: ArkmeDirectorySectionKind,
  items: readonly ArkmeDirectoryItem[],
): ArkmeDirectorySelection {
  if (section === 'contacts' && selection.kind === 'contact') {
    return items.some(item => item.kind === 'contact' && item.contactRef === selection.contactRef)
      ? selection
      : { kind: 'none' }
  }
  if (section === 'unmarked-speakers' && selection.kind === 'unmarked-speaker') {
    return items.some(item => item.kind === 'unmarked-speaker' && item.candidateRef === selection.candidateRef)
      ? selection
      : { kind: 'none' }
  }
  return selection
}

function updateSection(
  state: ContactDirectoryState,
  section: ArkmeDirectorySectionKind,
  next: ContactDirectorySectionState,
): ContactDirectoryState {
  return { ...state, sections: { ...state.sections, [section]: next } }
}

export function contactDirectoryReducer(
  state: ContactDirectoryState,
  action: ContactDirectoryAction,
): ContactDirectoryState {
  switch (action.type) {
    case 'reset-account':
      return createContactDirectoryState(action.accountKey)
    case 'select':
      return { ...state, selection: action.selection }
    case 'set-expanded': {
      const current = state.sections[action.section]
      if (current.expanded === action.expanded) return state
      return updateSection(state, action.section, { ...current, expanded: action.expanded })
    }
    case 'load-start': {
      const current = state.sections[action.section]
      if (state.accountKey !== action.accountKey
        || current.accountKey !== action.accountKey
        || action.generation <= current.generation) return state
      if (action.mode === 'count') {
        return updateSection(state, action.section, { ...current, generation: action.generation })
      }
      return updateSection(state, action.section, {
        ...current,
        status: 'loading',
        generation: action.generation,
        warning: undefined,
        loadingMode: action.mode,
      })
    }
    case 'load-error': {
      if (!completionMatches(state, action.section, action.accountKey, action.generation)) return state
      const current = state.sections[action.section]
      return updateSection(state, action.section, {
        ...current,
        status: 'error',
        warning: action.message,
        loadingMode: undefined,
      })
    }
    case 'load-success': {
      if (action.page.section !== action.section
        || !completionMatches(state, action.section, action.accountKey, action.generation)) return state
      const current = state.sections[action.section]
      if (action.mode === 'count') {
        return updateSection(state, action.section, {
          ...current,
          total: action.page.total,
          loadingMode: undefined,
        })
      }
      if (action.mode === 'append' && action.page.cursorStale === true) {
        return updateSection(state, action.section, {
          ...current,
          status: 'idle',
          hasMore: false,
          nextCursor: undefined,
          warning: '目录已更新，正在重新加载',
          loadingMode: undefined,
        })
      }
      const items = action.mode === 'append'
        ? mergeDirectoryItems(current.items, action.page.items)
        : [...action.page.items]
      const next = {
        ...current,
        status: items.length === 0 ? 'empty' : 'ready',
        items,
        total: action.section === 'groups' || action.mode === 'append'
          ? Math.max(current.total, action.page.total, items.length)
          : Math.max(action.page.total, items.length),
        hasMore: action.page.hasMore,
        nextCursor: action.page.nextCursor,
        warning: action.page.projectionState === 'stale' || action.page.projectionState === 'failed'
          ? '目录数据可能不是最新状态'
          : undefined,
        loadingMode: undefined,
      } satisfies ContactDirectorySectionState
      return {
        ...updateSection(state, action.section, next),
        selection: action.mode === 'replace'
          ? selectionAfterReplacement(state.selection, action.section, items)
          : state.selection,
      }
    }
  }
}
