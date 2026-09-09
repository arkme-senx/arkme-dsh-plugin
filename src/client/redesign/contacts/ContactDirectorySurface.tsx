import { useCallback, useEffect, useReducer, useRef, useState, type ReactNode, type Ref } from 'react'
import type { ArkmeBotSummary, ArkmeDirectoryItem, ArkmeDirectoryPage, ArkmeDirectorySectionKind } from '../../../types.js'
import { callArkme } from '../../api.js'
import { retryArkmeRead } from '../../read-retry.js'
import { AlphabeticalContactList, DirectoryItemRow } from './AlphabeticalContactList.js'
import { CollapsibleDirectorySection } from './CollapsibleDirectorySection.js'
import { ContactDirectoryToolbar } from './ContactDirectoryToolbar.js'
import { normalizeDirectorySearch, projectDirectorySearch } from './contact-directory-search.js'
import {
  CONTACT_DIRECTORY_SECTION_ORDER,
  applyContactProfileUpdates,
  type ContactProfileUpdates,
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
  refresh?: true
}

export type ContactDirectoryPageLoader = (
  section: ArkmeDirectorySectionKind,
  options: ContactDirectoryLoadOptions,
  signal: AbortSignal,
) => Promise<ArkmeDirectoryPage>

export interface ContactDirectorySurfaceProps {
  active?: boolean
  accountKey: string
  toolbarActions?: ReactNode
  contactProfiles?: ContactProfileUpdates
  initialState?: ContactDirectoryState
  cacheFresh?: boolean
  selection?: ArkmeDirectorySelection
  refreshRevision?: number
  contactsAddedRevision?: number
  expandedSections?: Readonly<Record<ArkmeDirectorySectionKind, boolean>>
  onSelectionChange(selection: ArkmeDirectorySelection): void
  onExpandedChange?(section: ArkmeDirectorySectionKind, expanded: boolean): void
  onOpenGroup(sourceRef: string): void
  onOpenBot(bot: ArkmeBotSummary): void
  onStateChange?(state: ContactDirectoryState, refreshed: boolean, acknowledgedProfiles?: ContactProfileUpdates): void
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
    || (item.kind === 'team' && selection.kind === 'team' && item.teamRef === selection.teamRef)
    || (item.kind === 'unmarked-speaker'
      && selection.kind === 'unmarked-speaker'
      && item.candidateRef === selection.candidateRef)
}

export function ContactDirectoryContent({
  state,
  directoryRef,
  countLabels = {},
  searchStatus,
  searching = false,
  onToggle,
  onRetry,
  onLoadMore,
  onSelect,
  onOpenGroup,
  onOpenBot,
}: {
  state: ContactDirectoryState
  directoryRef?: Ref<HTMLElement>
  countLabels?: Partial<Record<ArkmeDirectorySectionKind, string>>
  searchStatus?: string | undefined
  searching?: boolean
  onToggle(section: ArkmeDirectorySectionKind): void
  onRetry(section: ArkmeDirectorySectionKind): void
  onLoadMore(section: ArkmeDirectorySectionKind): void
  onSelect(selection: ArkmeDirectorySelection): void
  onOpenGroup(sourceRef: string): void
  onOpenBot(bot: ArkmeBotSummary): void
}) {
  return <nav ref={directoryRef} className="arkme-contact-directory" aria-label="联系人目录">
    {CONTACT_DIRECTORY_SECTION_ORDER.map(sectionKind => {
      const section = state.sections[sectionKind]
      const labels = SECTION_LABELS[sectionKind]
      return <CollapsibleDirectorySection
        key={sectionKind}
        section={section}
        label={labels.label}
        emptyLabel={searching ? '未找到匹配的项目' : labels.empty}
        {...(countLabels[sectionKind] === undefined ? {} : { countLabel: countLabels[sectionKind] })}
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
                      : item.kind === 'team' ? item.teamRef : item.contactRef}
                item={item}
                selected={itemIsSelected(item, state.selection)}
                onSelect={onSelect}
                onOpenGroup={onOpenGroup}
                onOpenBot={onOpenBot}
              />)}
            </div>}
      </CollapsibleDirectorySection>
    })}
    {searchStatus !== undefined && <div className="arkme-contact-directory-empty" role="status">{searchStatus}</div>}
  </nav>
}

const defaultLoadPage: ContactDirectoryPageLoader = async (section, options, signal) => await callArkme<ArkmeDirectoryPage>(
  'directory.list',
  {
    section,
    limit: options.limit,
    ...(options.cursor === undefined ? {} : { cursor: options.cursor }),
    ...(options.countOnly === true ? { countOnly: true } : {}),
    ...(options.refresh === true ? { refresh: true } : {}),
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
  active = true,
  accountKey,
  initialState,
  toolbarActions,
  contactProfiles,
  cacheFresh,
  selection,
  refreshRevision = 0,
  contactsAddedRevision = 0,
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
    value => {
      if (value.initialState?.accountKey !== value.accountKey) return createContactDirectoryState(value.accountKey)
      const sections = { ...value.initialState.sections }
      // Requests from the previous mount were aborted; a cached loading flag cannot resume them.
      for (const kind of CONTACT_DIRECTORY_SECTION_ORDER) {
        const section = sections[kind]
        if (section.status === 'loading') sections[kind] = { ...section, status: 'idle', loadingMode: undefined }
      }
      return { ...value.initialState, sections }
    },
  )
  const [search, setSearch] = useState({ accountKey, value: '', expanded: {} as Partial<Record<ArkmeDirectorySectionKind, boolean>> })
  const searchValue = search.accountKey === accountKey ? search.value : ''
  const query = normalizeDirectorySearch(searchValue)
  const directoryRef = useRef<HTMLElement>(null)
  const pageCursorsRef = useRef<Partial<Record<ArkmeDirectorySectionKind, Set<string>>>>({})
  const staleRestartsRef = useRef<Partial<Record<ArkmeDirectorySectionKind, number>>>({})
  const stateRef = useRef(state)
  const controllersRef = useRef<Partial<Record<ArkmeDirectorySectionKind, AbortController>>>({})
  const generationsRef = useRef<Partial<Record<ArkmeDirectorySectionKind, number>>>({})
  const refreshRevisionRef = useRef(refreshRevision)
  const contactsAddedRevisionRef = useRef(contactsAddedRevision)
  const wasActiveRef = useRef(active)
  const preserveContactsSelectionRef = useRef(false)
  const contactProfilesRef = useRef(contactProfiles)
  contactProfilesRef.current = contactProfiles
  const loadPageRef = useRef(loadPage)
  const onSelectionChangeRef = useRef(onSelectionChange)
  const onStateChangeRef = useRef(onStateChange)
  const refreshCachedOnMountRef = useRef(initialState?.accountKey === accountKey && !cacheFresh)
  loadPageRef.current = loadPage
  onSelectionChangeRef.current = onSelectionChange
  onStateChangeRef.current = onStateChange

  const commit = useCallback((action: ContactDirectoryAction, acknowledgedProfiles?: ContactProfileUpdates): ContactDirectoryState => {
    const next = contactDirectoryReducer(stateRef.current, action)
    stateRef.current = next
    dispatch(action)
    onStateChangeRef.current?.(next, action.type === 'load-success' && action.mode !== 'count', acknowledgedProfiles)
    return next
  }, [])

  useEffect(() => {
    if (stateRef.current.accountKey === accountKey) return
    for (const controller of Object.values(controllersRef.current)) controller?.abort()
    controllersRef.current = {}
    generationsRef.current = {}
    pageCursorsRef.current = {}
    staleRestartsRef.current = {}
    preserveContactsSelectionRef.current = false
    setSearch({ accountKey, value: '', expanded: {} })
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
    const profilesAtStart = contactProfilesRef.current
    if (!active || snapshot.accountKey !== accountKey || (!force && snapshot.status === 'loading')) return
    if (mode === 'append' && (!snapshot.hasMore || snapshot.nextCursor === undefined)) return
    controllersRef.current[section]?.abort()
    const controller = new AbortController()
    controllersRef.current[section] = controller
    if (force) delete staleRestartsRef.current[section]
    if (mode === 'replace') pageCursorsRef.current[section] = new Set()
    const cursors = pageCursorsRef.current[section] ??= new Set<string>()
    if (mode === 'append' && snapshot.nextCursor !== undefined) cursors.add(snapshot.nextCursor)
    const generation = Math.max(snapshot.generation, generationsRef.current[section] ?? 0) + 1
    generationsRef.current[section] = generation
    commit({ type: 'load-start', section, accountKey, generation, mode })
    const options: ContactDirectoryLoadOptions = {
      limit: mode === 'count' ? 0 : 50,
      ...(mode === 'count' ? { countOnly: true } : {}),
      ...(force && mode === 'replace' ? { refresh: true } : {}),
      ...(mode === 'append' && snapshot.nextCursor !== undefined ? { cursor: snapshot.nextCursor } : {}),
    }
    void retryArkmeRead(() => loadPageRef.current(section, options, controller.signal), { signal: controller.signal, retryDelays: [250, 750] }).then(page => {
      if (controller.signal.aborted) return
      if (mode === 'append' && page.cursorStale === true) {
        if ((staleRestartsRef.current[section] ?? 0) >= 1) throw new Error('目录持续更新，请稍后重试')
        staleRestartsRef.current[section] = 1
      } else if (mode === 'append' && !page.hasMore) {
        delete staleRestartsRef.current[section]
      }
      if (mode !== 'count' && page.cursorStale !== true && page.hasMore && (page.nextCursor === undefined
        || page.nextCursor === '' || cursors.has(page.nextCursor))) {
        throw new Error('目录分页未能继续，请重试')
      }
      const action = {
        type: 'load-success', section, accountKey, generation, mode, page,
        preserveSelection: section === 'contacts' && preserveContactsSelectionRef.current,
      } as const
      const before = stateRef.current
      const acknowledgedProfiles = section === 'contacts' && page.section === section
        && mode !== 'count' && page.cursorStale !== true && profilesAtStart !== undefined
        ? Object.fromEntries(page.items.flatMap(item => {
          const profile = item.kind === 'contact' ? profilesAtStart[item.contactRef] : undefined
          return profile === undefined ? [] : [[profile.contactRef, profile] as const]
        }))
        : undefined
      const next = commit(action, acknowledgedProfiles)
      if (section === 'contacts' && mode !== 'count' && page.cursorStale !== true && !page.hasMore) preserveContactsSelectionRef.current = false
      if (before.selection.kind !== 'none' && next.selection.kind === 'none') {
        onSelectionChangeRef.current({ kind: 'none' })
      }
    }).catch(error => {
      if (controller.signal.aborted) return
      if (mode === 'count') return
      commit({ type: 'load-error', section, accountKey, generation, message: errorMessage(error) })
    })
  }, [active, accountKey, commit])

  useEffect(() => {
    if (refreshCachedOnMountRef.current) return
    for (const kind of CONTACT_DIRECTORY_SECTION_ORDER) {
      const section = state.sections[kind]
      if ((kind !== 'contacts' && query === '') || section.accountKey !== accountKey
        || (section.status !== 'ready' && section.status !== 'empty')
        || !section.hasMore || section.nextCursor === undefined) continue
      load(kind, 'append')
    }
  }, [accountKey, state, query, load])

  useEffect(() => {
    if (!active || refreshRevisionRef.current === refreshRevision) return
    refreshRevisionRef.current = refreshRevision
    load('unmarked-speakers', 'replace', true)
  }, [active, load, refreshRevision])

  useEffect(() => {
    const resumingStaleDirectory = active && !wasActiveRef.current && cacheFresh === false
    wasActiveRef.current = active
    if (!active) return
    const contactsAdded = contactsAddedRevisionRef.current !== contactsAddedRevision
    if (!contactsAdded && !resumingStaleDirectory) return
    contactsAddedRevisionRef.current = contactsAddedRevision
    // Adding a contact does not remove the current detail, even when it lives on a later page.
    if (contactsAdded) preserveContactsSelectionRef.current = true
    const sections = resumingStaleDirectory ? CONTACT_DIRECTORY_SECTION_ORDER : ['contacts'] as const
    for (const section of sections) load(section, 'replace', true)
  }, [active, cacheFresh, load, contactsAddedRevision])

  const controlledSelectionKey = selection?.kind === 'contact'
    ? `contact:${selection.contactRef}`
    : selection?.kind === 'team'
      ? `team:${selection.teamRef}`
      : selection?.kind === 'unmarked-speaker'
        ? `unmarked-speaker:${selection.candidateRef}`
        : selection?.kind ?? 'uncontrolled'
  useEffect(() => {
    if (selection === undefined) return
    const current = stateRef.current.selection
    const matches = current.kind === selection.kind
      && (current.kind === 'none'
        || (current.kind === 'contact' && selection.kind === 'contact' && current.contactRef === selection.contactRef)
        || (current.kind === 'team' && selection.kind === 'team' && current.teamRef === selection.teamRef)
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
    if (!active || !refreshCachedOnMountRef.current) return
    refreshCachedOnMountRef.current = false
    for (const section of CONTACT_DIRECTORY_SECTION_ORDER) {
      const cached = stateRef.current.sections[section]
      if (cached.expanded || cached.status === 'ready' || cached.status === 'empty') load(section, 'replace', true)
    }
  }, [active, load])

  const handleToggle = (section: ArkmeDirectorySectionKind) => {
    if (query !== '') {
      setSearch(current => ({ ...current, expanded: { ...current.expanded, [section]: !projection.state.sections[section].expanded } }))
      return
    }
    const current = stateRef.current.sections[section]
    const expanded = !current.expanded
    commit({ type: 'set-expanded', section, expanded })
    onExpandedChange?.(section, expanded)
  }
  const handleSelect = (selection: ArkmeDirectorySelection) => {
    commit({ type: 'select', selection })
    onSelectionChangeRef.current(selection)
  }

  const accountState = applyContactProfileUpdates(directoryStateForAccount(state, accountKey), contactProfiles)
  const visibleState = selection === undefined ? accountState : { ...accountState, selection }
  const projection = projectDirectorySearch(visibleState, query, search.accountKey === accountKey ? search.expanded : {})
  return <div className="arkme-contact-directory-surface">
    <ContactDirectoryToolbar value={searchValue} onChange={value => {
      setSearch({ accountKey, value, expanded: {} })
      if (directoryRef.current !== null) directoryRef.current.scrollTop = 0
    }}>{toolbarActions}</ContactDirectoryToolbar>
    <ContactDirectoryContent
      directoryRef={directoryRef}
      state={projection.state}
      countLabels={projection.countLabels}
      searchStatus={projection.status}
      searching={query !== ''}
      onToggle={handleToggle}
      onRetry={section => { delete staleRestartsRef.current[section]; load(section, 'replace', true) }}
      onLoadMore={section => { load(section, 'append') }}
      onSelect={handleSelect}
      onOpenGroup={onOpenGroup}
      onOpenBot={onOpenBot}
    />
  </div>
}
