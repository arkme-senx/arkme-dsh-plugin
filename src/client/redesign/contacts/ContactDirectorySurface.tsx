import { useCallback, useEffect, useReducer, useRef } from 'react'
import type { ArkmeBotSummary, ArkmeDirectoryItem, ArkmeDirectoryPage, ArkmeDirectorySectionKind } from '../../../types.js'
import { callArkme } from '../../api.js'
import { AlphabeticalContactList, DirectoryItemRow } from './AlphabeticalContactList.js'
import { CollapsibleDirectorySection } from './CollapsibleDirectorySection.js'
import {
  CONTACT_DIRECTORY_SECTION_ORDER,
  contactDirectoryReducer,
  createContactDirectoryState,
  sectionNeedsInitialLoad,
  type ArkmeDirectorySelection,
  type ContactDirectoryAction,
  type ContactDirectoryLoadMode,
  type ContactDirectoryState,
} from './contact-directory-state.js'

export { DirectoryItemRow } from './AlphabeticalContactList.js'

const SECTION_LABELS: Record<ArkmeDirectorySectionKind, { label: string; empty: string }> = {
  groups: { label: '群聊', empty: '暂无群聊' },
  bots: { label: 'Bot', empty: '暂无 Bot' },
  'unmarked-speakers': { label: '未标记说话人', empty: '暂无未标记说话人' },
  teams: { label: '团队', empty: '暂无团队' },
  contacts: { label: '联系人', empty: '暂无联系人' },
}

export interface ContactDirectoryLoadOptions {
  limit: number
  cursor?: string
  countOnly?: true
}

export type ContactDirectoryPageLoader = (
  section: ArkmeDirectorySectionKind,
  options: ContactDirectoryLoadOptions,
  signal: AbortSignal,
) => Promise<ArkmeDirectoryPage>

export interface ContactDirectorySurfaceProps {
  accountKey: string
  initialState?: ContactDirectoryState
  cacheFresh?: boolean
  selection?: ArkmeDirectorySelection
  refreshRevision?: number
  expandedSections?: Readonly<Record<ArkmeDirectorySectionKind, boolean>>
  onSelectionChange(selection: ArkmeDirectorySelection): void
  onExpandedChange?(section: ArkmeDirectorySectionKind, expanded: boolean): void
  onOpenGroup(sourceRef: string): void
  onOpenBot(bot: ArkmeBotSummary): void
  onStateChange?(state: ContactDirectoryState, refreshed: boolean): void
  loadPage?: ContactDirectoryPageLoader
}

function sectionItems<K extends ArkmeDirectoryItem['kind']>(
  items: readonly ArkmeDirectoryItem[],
  kind: K,
): Array<Extract<ArkmeDirectoryItem, { kind: K }>> {
  return items.filter((item): item is Extract<ArkmeDirectoryItem, { kind: K }> => item.kind === kind)
}

function itemIsSelected(item: ArkmeDirectoryItem, selection: ArkmeDirectorySelection): boolean {
  return (item.kind === 'contact' && selection.kind === 'contact' && item.contactRef === selection.contactRef)
    || (item.kind === 'unmarked-speaker'
      && selection.kind === 'unmarked-speaker'
      && item.candidateRef === selection.candidateRef)
}

export function ContactDirectoryContent({
  state,
  onToggle,
  onRetry,
  onLoadMore,
  onSelect,
  onOpenGroup,
  onOpenBot,
}: {
  state: ContactDirectoryState
  onToggle(section: ArkmeDirectorySectionKind): void
  onRetry(section: ArkmeDirectorySectionKind): void
  onLoadMore(section: ArkmeDirectorySectionKind): void
  onSelect(selection: ArkmeDirectorySelection): void
  onOpenGroup(sourceRef: string): void
  onOpenBot(bot: ArkmeBotSummary): void
}) {
  return <nav className="arkme-contact-directory" aria-label="联系人目录">
    {CONTACT_DIRECTORY_SECTION_ORDER.map(sectionKind => {
      const section = state.sections[sectionKind]
      const labels = SECTION_LABELS[sectionKind]
      return <CollapsibleDirectorySection
        key={sectionKind}
        section={section}
        label={labels.label}
        emptyLabel={labels.empty}
        onToggle={() => { onToggle(sectionKind) }}
        onRetry={() => { onRetry(sectionKind) }}
        onLoadMore={() => { onLoadMore(sectionKind) }}
      >
        {sectionKind === 'contacts'
          ? <AlphabeticalContactList
              items={sectionItems(section.items, 'contact')}
              selection={state.selection}
              onSelect={onSelect}
              onOpenGroup={onOpenGroup}
              onOpenBot={onOpenBot}
            />
          : <div className="arkme-contact-directory-list" role="list">
              {section.items.map(item => <DirectoryItemRow
                key={item.kind === 'group' ? item.sourceRef
                  : item.kind === 'bot' ? item.bot.botRef
                    : item.kind === 'unmarked-speaker' ? item.candidateRef
                      : item.kind === 'team' ? item.rowKey : item.contactRef}
                item={item}
                selected={itemIsSelected(item, state.selection)}
                onSelect={onSelect}
                onOpenGroup={onOpenGroup}
                onOpenBot={onOpenBot}
              />)}
            </div>}
      </CollapsibleDirectorySection>
    })}
  </nav>
}

const defaultLoadPage: ContactDirectoryPageLoader = async (section, options, signal) => await callArkme<ArkmeDirectoryPage>(
  'directory.list',
  {
    section,
    limit: options.limit,
    ...(options.cursor === undefined ? {} : { cursor: options.cursor }),
    ...(options.countOnly === true ? { countOnly: true } : {}),
  },
  signal,
)

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message.trim() !== '' ? error.message : '目录加载失败'
}

export function directoryStateForAccount(
  state: ContactDirectoryState,
  accountKey: string,
): ContactDirectoryState {
  return state.accountKey === accountKey ? state : createContactDirectoryState(accountKey)
}

export function ContactDirectorySurface({
  accountKey,
  initialState,
  cacheFresh = false,
  selection,
  refreshRevision = 0,
  expandedSections,
  onSelectionChange,
  onExpandedChange,
  onOpenGroup,
  onOpenBot,
  onStateChange,
  loadPage = defaultLoadPage,
}: ContactDirectorySurfaceProps) {
  const [state, dispatch] = useReducer(
    contactDirectoryReducer,
    { accountKey, initialState },
    value => value.initialState?.accountKey === value.accountKey
      ? value.initialState
      : createContactDirectoryState(value.accountKey),
  )
  const stateRef = useRef(state)
  const controllersRef = useRef<Partial<Record<ArkmeDirectorySectionKind, AbortController>>>({})
  const generationsRef = useRef<Partial<Record<ArkmeDirectorySectionKind, number>>>({})
  const refreshRevisionRef = useRef(refreshRevision)
  const loadPageRef = useRef(loadPage)
  const onSelectionChangeRef = useRef(onSelectionChange)
  const onStateChangeRef = useRef(onStateChange)
  const refreshCachedOnMountRef = useRef(initialState?.accountKey === accountKey && !cacheFresh)
  loadPageRef.current = loadPage
  onSelectionChangeRef.current = onSelectionChange
  onStateChangeRef.current = onStateChange

  const commit = useCallback((action: ContactDirectoryAction): ContactDirectoryState => {
    const next = contactDirectoryReducer(stateRef.current, action)
    stateRef.current = next
    dispatch(action)
    onStateChangeRef.current?.(next, action.type === 'load-success' && action.mode !== 'count')
    return next
  }, [])

  useEffect(() => {
    if (stateRef.current.accountKey === accountKey) return
    for (const controller of Object.values(controllersRef.current)) controller?.abort()
    controllersRef.current = {}
    generationsRef.current = {}
    const hadSelection = stateRef.current.selection.kind !== 'none'
    commit({ type: 'reset-account', accountKey })
    if (hadSelection) onSelectionChangeRef.current({ kind: 'none' })
  }, [accountKey, commit])

  useEffect(() => () => {
    for (const controller of Object.values(controllersRef.current)) controller?.abort()
  }, [])

  const load = useCallback((
    section: ArkmeDirectorySectionKind,
    mode: ContactDirectoryLoadMode,
    force = false,
  ) => {
    const snapshot = stateRef.current.sections[section]
    if (snapshot.accountKey !== accountKey || (!force && snapshot.status === 'loading')) return
    if (mode === 'append' && (!snapshot.hasMore || snapshot.nextCursor === undefined)) return
    controllersRef.current[section]?.abort()
    const controller = new AbortController()
    controllersRef.current[section] = controller
    const generation = Math.max(snapshot.generation, generationsRef.current[section] ?? 0) + 1
    generationsRef.current[section] = generation
    commit({ type: 'load-start', section, accountKey, generation, mode })
    const options: ContactDirectoryLoadOptions = {
      limit: mode === 'count' ? 0 : 50,
      ...(mode === 'count' ? { countOnly: true } : {}),
      ...(mode === 'append' && snapshot.nextCursor !== undefined ? { cursor: snapshot.nextCursor } : {}),
    }
    void loadPageRef.current(section, options, controller.signal).then(page => {
      const action = { type: 'load-success', section, accountKey, generation, mode, page } as const
      const before = stateRef.current
      const next = commit(action)
      if (before.selection.kind !== 'none' && next.selection.kind === 'none') {
        onSelectionChangeRef.current({ kind: 'none' })
      }
    }).catch(error => {
      if (controller.signal.aborted) return
      if (mode === 'count') return
      commit({ type: 'load-error', section, accountKey, generation, message: errorMessage(error) })
    })
  }, [accountKey, commit])

  const contactsSection = state.sections.contacts
  useEffect(() => {
    if (refreshCachedOnMountRef.current
      || contactsSection.accountKey !== accountKey
      || contactsSection.status !== 'ready'
      || !contactsSection.hasMore
      || contactsSection.nextCursor === undefined) return
    load('contacts', 'append')
  }, [
    accountKey,
    contactsSection.accountKey,
    contactsSection.hasMore,
    contactsSection.nextCursor,
    contactsSection.status,
    load,
  ])

  useEffect(() => {
    if (refreshRevisionRef.current === refreshRevision) return
    refreshRevisionRef.current = refreshRevision
    load('unmarked-speakers', 'replace', true)
  }, [load, refreshRevision])

  const controlledSelectionKey = selection?.kind === 'contact'
    ? `contact:${selection.contactRef}`
    : selection?.kind === 'unmarked-speaker'
      ? `unmarked-speaker:${selection.candidateRef}`
      : selection?.kind ?? 'uncontrolled'
  useEffect(() => {
    if (selection === undefined) return
    const current = stateRef.current.selection
    const matches = current.kind === selection.kind
      && (current.kind === 'none'
        || (current.kind === 'contact' && selection.kind === 'contact' && current.contactRef === selection.contactRef)
        || (current.kind === 'unmarked-speaker' && selection.kind === 'unmarked-speaker'
          && current.candidateRef === selection.candidateRef))
    if (!matches) commit({ type: 'select', selection })
  }, [commit, controlledSelectionKey, selection])

  const expandedSectionsKey = expandedSections === undefined
    ? undefined
    : CONTACT_DIRECTORY_SECTION_ORDER.map(section => `${section}:${expandedSections[section]}`).join('|')
  useEffect(() => {
    if (expandedSections === undefined) return
    for (const section of CONTACT_DIRECTORY_SECTION_ORDER) {
      if (stateRef.current.sections[section].expanded !== expandedSections[section]) {
        commit({ type: 'set-expanded', section, expanded: expandedSections[section] })
      }
    }
  }, [commit, expandedSections, expandedSectionsKey])

  useEffect(() => {
    for (const section of CONTACT_DIRECTORY_SECTION_ORDER) {
      if (sectionNeedsInitialLoad(state.sections[section])) load(section, 'replace')
    }
  }, [load, state])

  useEffect(() => {
    if (!refreshCachedOnMountRef.current) return
    refreshCachedOnMountRef.current = false
    for (const section of CONTACT_DIRECTORY_SECTION_ORDER) {
      const cached = stateRef.current.sections[section]
      if (cached.expanded || cached.status === 'ready' || cached.status === 'empty') load(section, 'replace', true)
    }
  }, [load])

  const handleToggle = (section: ArkmeDirectorySectionKind) => {
    const current = stateRef.current.sections[section]
    const expanded = !current.expanded
    commit({ type: 'set-expanded', section, expanded })
    onExpandedChange?.(section, expanded)
  }
  const handleSelect = (selection: ArkmeDirectorySelection) => {
    commit({ type: 'select', selection })
    onSelectionChangeRef.current(selection)
  }

  const accountState = directoryStateForAccount(state, accountKey)
  const visibleState = selection === undefined ? accountState : { ...accountState, selection }
  return <ContactDirectoryContent
    state={visibleState}
    onToggle={handleToggle}
    onRetry={section => { load(section, 'replace') }}
    onLoadMore={section => { load(section, 'append') }}
    onSelect={handleSelect}
    onOpenGroup={onOpenGroup}
    onOpenBot={onOpenBot}
  />
}
