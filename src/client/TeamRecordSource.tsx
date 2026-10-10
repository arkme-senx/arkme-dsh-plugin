import { createContext, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import { CaretRight } from '@phosphor-icons/react/dist/icons/CaretRight'
import { Users } from '@phosphor-icons/react/dist/icons/Users'
import { Toast, IconWarningOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { TeamRecordSource as Source, TeamTimeline } from '../team-app-contract.js'
import { callArkme } from './api.js'
import { arkmeAuthStore } from './auth-store.js'
import { ResourceStore } from './resource-store.js'
import { useResource } from './use-resource.js'
import { openTeamMessages } from './team-messaging-events.js'
import { arkmeDetailSourceBadgeStyle } from './ArkmeDetailSourceBadgeVisuals.js'
import { teamText as tr } from './team-messaging-i18n.js'

const SourceStore = createContext<ResourceStore<Source, string> | undefined>(undefined)
const createStore = () => new ResourceStore<Source, string>({
  load: (conversationUid, signal) => callArkme('team.app.source', { conversationUid }, signal),
})

/** Reuse the query owner; scope optional labels to the mounted page and account. */
export function TeamRecordSourceScope({ children }: { children: ReactNode }) {
  const auth = useSyncExternalStore(arkmeAuthStore.subscribe, arkmeAuthStore.getSnapshot, arkmeAuthStore.getSnapshot).auth
  const key = `${auth?.status}:${auth?.environment}:${auth?.userId}`
  const store = useMemo(createStore, [key])
  useEffect(() => () => store.reset(), [store])
  return <SourceStore.Provider value={store}>{children}</SourceStore.Provider>
}

/** Record content does not wait for this label. Opening always rechecks Team authority. */
export function TeamRecordSource({ conversationUid, navigable = false, onOpened }: {
  conversationUid?: string | undefined; navigable?: boolean; onOpened?: (() => void) | undefined
}) {
  const scopedStore = useContext(SourceStore)
  const fallbackStore = useMemo(createStore, [])
  const store = scopedStore ?? fallbackStore
  const { snapshot } = useResource(store, conversationUid || undefined, conversationUid ?? '')
  const [busy, setBusy] = useState(false), [error, setError] = useState('')
  const button = useRef<HTMLButtonElement>(null)
  const lifetime = useRef(new AbortController())
  useEffect(() => {
    const controller = new AbortController(); lifetime.current = controller
    setBusy(false); setError('')
    return () => { controller.abort(); if (!scopedStore) fallbackStore.reset() }
  }, [store, conversationUid])
  const name = snapshot.error === undefined ? snapshot.value?.name || tr('团队对话') : tr('团队对话')
  if (!navigable) return <span>{name}</span>
  const open = async () => {
    if (!conversationUid || busy) return
    const signal = lifetime.current.signal
    setBusy(true); setError('')
    try {
      const source = await callArkme<Source>('team.app.source', { conversationUid }, signal)
      if (signal.aborted) return
      const timeline = await callArkme<TeamTimeline>('team.app.timeline', { conversationRef: source.conversationRef }, signal)
      if (signal.aborted) return
      onOpened?.()
      openTeamMessages({ kind: 'conversation', conversation: timeline.conversation })
    } catch {
      if (!signal.aborted) setError(tr('暂时无法打开团队对话，请稍后重试'))
    } finally { if (!signal.aborted) setBusy(false) }
  }
  return <>
    <button ref={button} type="button" data-arkme-feedback="neutral" style={{ ...arkmeDetailSourceBadgeStyle, cursor: 'pointer' }}
      disabled={!conversationUid || busy} aria-label={tr('来源：{v0}', { v0: name })}
      onClick={event => { event.stopPropagation(); void open() }}>
      <Users size={14} aria-hidden /><span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</span>
      <CaretRight size={12} aria-hidden />
    </button>
    {error && <Toast text={error} anchor={button.current} icon={<IconWarningOutline16 />} onDone={() => setError('')} />}
  </>
}
