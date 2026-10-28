import { useLayoutEffect, useRef, useState, type ComponentType, type ReactNode } from 'react'
import type { Context } from '@deepseek-ai/cordis'
import type { StoredEntry } from '@deepseek-ai/dsh-client-ui-slots'
import type { ChatNode } from '@deepseek-ai/dsh-client-ui-chat/client'
import type { DshRemoteTimelineNode } from '../dsh-remote/types.js'
import { HarnessHistoryConversation } from './HarnessHistoryConversation.js'
import { useAccountHistorySession } from './harness-account-sessions.js'
import { tr } from './locale.js'

type Render = (name: string, owner: object, options?: object) => ReactNode
type Props = { renderSlot: Render; [key: string]: unknown }
const COMPOSER = 'arkme.history.composer'
const NODE = 'arkme.history.node'

/** Project available message bodies; missing journal events never gate display or enter the native session store. */
export function historyMessageNode(item: DshRemoteTimelineNode): ChatNode<'user' | 'assistant-step'> | undefined {
  if (item.kind !== 'user' && item.kind !== 'assistant') return
  const data = item.data ?? {}, message = data.message as { content?: unknown } | undefined
  const raw = item.kind === 'user' ? data.content : data.blocks ?? message?.content
  const blocks = Array.isArray(raw) ? raw : []
  const fallback = item.presentation.details || item.presentation.summary || item.presentation.title || ''
  const base = { key: item.node_ref, id: item.node_ref, target: 'chat' as const, anchorSeq: item.anchor_seq, location: { kind: 'unresolved' as const }, visibility: 'visible' as const }
  if (item.kind === 'user') return { ...base, kind: 'user', data: { kind: 'user', seq: item.anchor_seq, time: item.time, source: undefined,
    content: blocks.length ? blocks : [{ type: 'text', text: fallback }] } }
  const text = blocks.flatMap(block => {
    const kind = block?.kind ?? block?.type
    return (kind === 'text' || kind === 'reasoning') && typeof block.text === 'string' ? [{ kind, text: block.text }] : []
  })
  return { ...base, kind: 'assistant-step', data: { status: 'settled', turn: 0, step: 0, time: item.time,
    blocks: text.length ? text : [{ kind: 'text', text: fallback }] } }
}

function useDisclosure() {
  const [expanded, setExpanded] = useState(false)
  return { expanded, setExpanded, toggle: () => setExpanded(value => !value) }
}
const useGroupAction = () => useRef<HTMLDivElement>(null)
const useTurnData = () => undefined
const loadImage = async () => { throw new Error(tr('图片暂无可用内容')) }
const noop = () => undefined

/** Mirror public registered components into caller-owned seats; their styles, injection and children remain native. */
function mirrorSlot(ctx: Context, source: string, target: string, keys?: readonly string[]): () => void {
  const slots = ctx.slots
  const entries = slots.entriesOfSlot.bind(slots) as unknown as (name: string) => readonly StoredEntry[]
  const subscribe = slots.subscribe.bind(slots) as unknown as (name: string, listener: () => void) => () => void
  const register = slots.register.bind(slots) as unknown as (options: object, component: unknown) => () => void
  let previous: readonly StoredEntry[] = [], restores: Array<() => void> = []
  const sync = () => {
    const next = entries(source).filter(entry => !keys || keys.includes(entry.options.key as string))
    if (next.length === previous.length && next.every((entry, index) => entry === previous[index])) return
    restores.reverse().forEach(dispose => dispose()); restores = []; previous = [...next]
    for (const entry of next) {
      const children = Object.keys(entry.children ?? {})
      const own = (name: string) => `${target}.${entry.options.key ?? 'default'}.${name}`
      const Native = entry.component as ComponentType<Props>
      restores.push(register({ ...entry.options, name: target, store: entry.store, inject: source === 'conversation.composer.bar' && entry.inject ? () => entry.inject!(undefined as never) : entry.inject, locale: entry.locale,
        ...(entry.children ? { children: Object.fromEntries(children.map(name => [own(name), entry.children![name as keyof typeof entry.children]])) } : {}) },
      (props: Props) => <div data-slot={source} style={{ display: 'contents' }}><Native {...props}
        {...(source === 'conversation.composer.bar' ? { sessionId: undefined, useInput: noop, useSession: noop, inputActions: undefined, keyboard: undefined, placeholder: typeof props.t === 'function' ? props.t('placeholder.default') : undefined } : {})}
        renderSlot={(name, owner, options) => props.renderSlot(own(name), owner, options)} /></div>))
      for (const child of children) restores.push(mirrorSlot(ctx, child, own(child)))
    }
  }
  const stop = subscribe(source, sync); sync()
  return () => { stop(); restores.reverse().forEach(dispose => dispose()) }
}

/** The native conversation stays mounted, preserving the local draft and executable owner. */
export function installHarnessHistoryConversation(ctx: Context, surface: Element): () => void {
  const slots = ctx.slots
  if (typeof slots.entries !== 'function' || typeof slots.subscribe !== 'function') return () => {}
  let previous: StoredEntry | undefined, restore: (() => void) | undefined, updating = false
  const sync = () => {
    if (updating) return
    const native = slots.entries('main.conversation').find(entry => (entry.options.priority ?? 0) >= 0)
    if (native === previous) return
    updating = true
    restore?.(); restore = undefined; previous = native
    try {
      if (!native) return
      const Native = native.component as ComponentType<Props>
      const children = Object.keys(native.children ?? {}), own = (name: string) => `arkme.history.original.${name}`
      const Wrapped = (props: Props) => {
        const session = useAccountHistorySession(surface, true)
        const visible = useRef<HTMLDivElement>(null)
        useLayoutEffect(() => { if (visible.current) visible.current.inert = !!session }, [session])
        return <>
          <div ref={visible} aria-hidden={session ? true : undefined} style={{ display: session ? 'none' : 'contents' }}>
            <Native {...props} renderSlot={(name, owner, options) => props.renderSlot(own(name), owner, options)} />
          </div>
          {session && <HarnessHistoryConversation key={`${session.runtimeRef}:${session.sessionRef}`} session={session} accountScope={surface.getAttribute('data-arkme-account-scope') ?? ''}
            composer={props.renderSlot(COMPOSER, { variant: 'composer', disabled: true })}
            renderNode={item => {
              const node = historyMessageNode(item)
              return node ? props.renderSlot(NODE, { node, loadImage, useDisclosure, useGroupAction, useTurnData, openFile: noop, fileMentions: noop }, { entryKey: node.kind })
                : <details style={{ fontSize: 'var(--dsh-content-font-size-secondary, 13px)', color: 'var(--dsw-alias-label-secondary)' }}><summary>{item.presentation.title || item.kind}</summary><pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{item.presentation.details || item.presentation.summary}</pre></details>
            }} />}
        </>
      }
      const register = slots.register.bind(slots) as unknown as (options: object, component: unknown) => () => void
      const remove = register({ name: 'main.conversation', priority: -100, children: {
        ...Object.fromEntries(children.map(name => [own(name), native.children![name as keyof typeof native.children]])),
        [COMPOSER]: { kind: 'single', scope: 'session-maybe' }, [NODE]: { kind: 'keyed', scope: 'session-maybe' },
      } }, Wrapped)
      const mirrors = [...children.map(name => mirrorSlot(ctx, name, own(name))), mirrorSlot(ctx, 'conversation.composer.bar', COMPOSER), mirrorSlot(ctx, 'conversation.chat.node', NODE, ['user', 'assistant-step'])]
      restore = () => { mirrors.reverse().forEach(dispose => dispose()); remove() }
    } finally { updating = false }
  }
  const stop = slots.subscribe('main.conversation', sync); sync()
  return () => { stop(); updating = true; restore?.() }
}
