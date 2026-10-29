import { createContext, useContext, useEffect, useMemo, useSyncExternalStore, type ComponentType, type ReactNode } from 'react'
import type { Context } from '@deepseek-ai/cordis'
import type { StoredEntry } from '@deepseek-ai/dsh-client-ui-slots'
import { tr } from './locale.js'
import { callArkme } from '../sdk/index.js'
import { useAccountSessionCatalog, accountSessionKey } from './harness-account-sessions.js'
import { harnessSessions } from './harness-session-state.js'
import { createProjectedHistory, type ProjectedHistorySnapshot } from './harness-projected-history.js'
import type { DshAccountSessionHistory } from '../dsh-remote/account-session-types.js'

type Props = Record<string, any> & { renderSlot(name: string, owner: object, options?: object): ReactNode }
const PREFIX = 'arkme.projectedHistory.'
const History = createContext<ProjectedHistorySnapshot | undefined>(undefined)

function projectedProps(props: Props, state: ProjectedHistorySnapshot): Props {
  const useSession = <T,>(select: (value: any) => T) => props.useSession((native: object) => select({ ...native,
    openState: state.openState, openError: state.openError, hasMore: state.hasMore, loadingOlder: state.loadingOlder,
    running: false, pendingSubmissions: [], blank: false, awaitingFirstTurn: false }))
  const conversation = { activeTargets: new Set(['chat']), views: { get: () => state.chat, grouped: () => undefined } }
  return { ...props, useSession, useChat: (select: (value: unknown) => unknown) => select(state.chat),
    useConversation: (select: (value: unknown) => unknown) => select(conversation),
    useChatNode: (key: string, select = (value: unknown) => value) => select(state.chat.nodes.get(key)),
    useChatNodeBottom: (_key: string, select = (value: unknown) => value) => select(false),
    useChatNodeProcess: (_key: string, select = (value: unknown) => value) => select(undefined),
    useChatGroup: (_key: string, select = (value: unknown) => value) => select(undefined),
    useProjection: () => undefined, inspectCall: undefined, forkAt: undefined,
    // A projected path belongs to the source computer, never this Host's filesystem.
    openFile: async () => { throw new Error(tr('请在对话所属实例或电脑上查看文件')) },
  }
}

/** Only the message subtree is adapted. No extra DOM anchors, header, composer, or shell aliases. */
function mirrorMessages(ctx: Context, source: string, target: string): () => void {
  const slots = ctx.slots
  const entries = slots.entriesOfSlot.bind(slots) as (name: string) => readonly StoredEntry[]
  const register = slots.register.bind(slots) as (options: object, component: unknown) => () => void
  let previous: readonly StoredEntry[] = [], disposers: Array<() => void> = []
  const sync = () => {
    const next = entries(source)
    if (next.length === previous.length && next.every((entry, i) => entry === previous[i])) return
    disposers.reverse().forEach(dispose => dispose()); disposers = []; previous = [...next]
    for (const entry of next) {
      const Native = entry.component as ComponentType<Props>
      const children = Object.keys(entry.children ?? {}), own = (name: string) => `${target}.${entry.options.key ?? entry.options.id ?? 'default'}.${name}`
      const Wrapped = (props: Props) => {
        const state = useContext(History)
        const adapted = state && source === 'conversation.chat.flow' ? projectedProps(props, state) : props
        return <Native {...adapted} renderSlot={(name, owner, options) => props.renderSlot(own(name), owner, options)} />
      }
      disposers.push(register({ ...entry.options, name: target, store: entry.store, inject: entry.inject, locale: entry.locale,
        ...(entry.children ? { children: Object.fromEntries(children.map(name => [own(name), entry.children![name]])) } : {}) }, Wrapped))
      for (const child of children) disposers.push(mirrorMessages(ctx, child, own(child)))
    }
  }
  const stop = (slots.subscribe as (name: string, listener: () => void) => () => void)(source, sync)
  sync()
  return () => { stop(); disposers.reverse().forEach(dispose => dispose()) }
}

/** Preserve the native chat viewport, pagination, typography and message components. */
function ProjectedConversation({ Native, ...props }: Props & { Native: ComponentType<Props> }) {
  const id = String(props.sessionId), parts = id.split(':')
  const runtimeRef = decodeURIComponent(parts[1] ?? ''), sessionRef = decodeURIComponent(parts[2] ?? '')
  const history = useMemo(() => createProjectedHistory((cursor, signal) => callArkme<DshAccountSessionHistory>(
    'remote.session.read', { runtimeRef, sessionRef, source: 'cloud', ...(cursor ? { cursor } : {}) }, signal)), [runtimeRef, sessionRef])
  const state = useSyncExternalStore(history.subscribe, history.getSnapshot)
  useEffect(() => { void history.load(); return () => history.dispose() }, [history])
  const adapted = projectedProps(props, state)
  return <History.Provider value={state}><Native {...adapted} loadOlder={() => { void history.load() }} loadThrough={async () => { await history.load() }}
    renderSlot={(name, owner, options) => props.renderSlot(`${PREFIX}${name}`, owner, options)} /></History.Provider>
}

/** The native local tree is never shadowed. A remote selection owns only the session content seat. */
export function installProjectedConversation(ctx: Context, surface: Element): () => void {
  const slots = ctx.slots
  if (!ctx.sessions?.list) return () => {}
  const sessions = harnessSessions(ctx)
  if (!sessions || typeof slots.entries !== 'function' || typeof slots.subscribe !== 'function') return () => {}
  let remove: (() => void) | undefined, installedFor: string | undefined, installedNative: StoredEntry | undefined, updating = false
  const sync = () => {
    if (updating) return
    const id = sessions.list.getSnapshot().current
    const active = id?.startsWith('arkme:') && surface.getAttribute('data-arkme-visible') !== 'false'
    const native = slots.entries('conversation.view').find(entry => entry.options.id === 'chat' && (entry.options.priority ?? 0) >= 0)
    if (active && installedFor === id && installedNative === native && remove) return
    updating = true
    try {
      remove?.(); remove = undefined; installedFor = undefined; installedNative = undefined
      if (!active || !native || !slots.spec('conversation.session')) return
      const children = Object.keys(native.children ?? {})
      if (children.length !== 1 || children[0] !== 'conversation.chat.flow') return
      const Native = native.component as ComponentType<Props>
      const register = slots.register.bind(slots) as (options: object, component: unknown) => () => void
      const removeView = register({ name: 'conversation.session', priority: -100, store: native.store, inject: native.inject, locale: native.locale,
        children: Object.fromEntries(children.map(name => [`${PREFIX}${name}`, native.children![name]])) },
      (props: Props) => <ProjectedConversation key={String(props.sessionId)} {...props} Native={Native} />)
      const stopMessages = mirrorMessages(ctx, 'conversation.chat.flow', `${PREFIX}conversation.chat.flow`)
      // An additive native corner, never a second title or a replacement header.
      const stopOrigin = slots.spec('conversation.session.header.corner') ? register({ name: 'conversation.session.header.corner', priority: -100 }, () => {
        const snapshot = useAccountSessionCatalog(surface)
        const row = snapshot.rows.find(row => accountSessionKey(row) === id)
        return <span title={row?.runtimeName} style={{ fontSize: 12, opacity: .65, whiteSpace: 'nowrap' }}>{tr('其他实例')}{row?.desktopName ? ` · ${row.desktopName}` : ''}</span>
      }) : () => {}
      installedFor = id; installedNative = native
      remove = () => { stopOrigin(); stopMessages(); removeView() }
    } finally { updating = false }
  }
  const stops = [sessions.list.subscribe(sync), slots.subscribe('conversation.view', sync), slots.subscribe('conversation.session', sync)]
  const observer = new MutationObserver(sync)
  observer.observe(surface, { attributes: true, attributeFilter: ['data-arkme-visible'] })
  sync()
  return () => { stops.forEach(stop => stop()); observer.disconnect(); remove?.() }
}
