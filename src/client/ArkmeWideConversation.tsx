import { Component, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode, type RefObject } from 'react'
import { ARKME_WIDE_CONVERSATION_MIN } from '../harness-conversation-layout-contract.js'
import { loadHarnessConversationLayout, type HarnessConversationLayout, type NativeRailItem } from './harness-conversation-layout.js'
import { ArkmeUserAvatar } from './ArkmeAvatar.js'
import { ArkmeArkoAvatar } from './ArkmeArkoAvatar.js'

export const WIDE_CONVERSATION_WIDTH_KEY = 'arkme:conversation-content-width:v1'
const ANCHOR = '[data-arkme-width-anchor]'
const css = `
[data-arkme-wide-conversation="true"] [data-arkme-width-viewport] {
  box-sizing:border-box;
  padding-inline:max(22px, calc((100% - var(--dsh-chat-content-width)) / 2)) !important;
}
[data-arkme-wide-conversation="true"] [data-arkme-width-composer] {
  box-sizing:border-box;
  width:min(100%, calc(var(--dsh-composer-card-max-width) + 48px));
  margin-inline:auto;
}
[data-arkme-wide-conversation="true"] [data-width-handle] {touch-action:none}
[data-arkme-native-turn-rail] [role="tooltip"] > :has(> [data-arkme-rail-preview]) {
  display:block;
  -webkit-line-clamp:unset;
}
`

export interface ConversationRailSpeaker {
  name: string
  kind: 'human' | 'bot' | 'arko'
  avatarRef: string
}
export type ConversationRailItem = NativeRailItem & {
  speaker: ConversationRailSpeaker
  responseSpeaker?: ConversationRailSpeaker
}
type RailAnchor = ConversationRailItem & { element: HTMLElement }

function readSpeaker(element: HTMLElement): ConversationRailSpeaker {
  const kind = element.dataset.arkmeWidthSenderKind
  return {
    name: element.dataset.arkmeWidthSender || '发言者',
    kind: kind === 'arko' || kind === 'bot' ? kind : 'human',
    avatarRef: element.dataset.arkmeWidthAvatar || '',
  }
}

/** Only supply preview content; native DSH still owns tooltip/hover/positioning. */
export function ConversationRailPreview({ speaker, text, response = false }: {
  speaker: ConversationRailSpeaker
  text: string
  response?: boolean
}) {
  return <span data-arkme-rail-preview={response ? 'response' : 'prompt'} style={{ display: 'flex', alignItems: response ? 'flex-start' : 'center', gap: 8, minWidth: 0 }}>
    <span role="img" aria-label={`${speaker.name}的头像`} style={{ display: 'flex', flex: 'none', width: 28, height: 28 }}>
      {speaker.kind === 'arko' ? <ArkmeArkoAvatar size={28} /> : <ArkmeUserAvatar
        avatarRef={speaker.avatarRef} senderKind={speaker.kind} label={`${speaker.name}的头像`} size={28} />}
    </span>
    <span style={{ minWidth: 0, flex: 1, display: '-webkit-box', WebkitBoxOrient: 'vertical', WebkitLineClamp: response ? 2 : 1, overflow: 'hidden', overflowWrap: 'anywhere' }}>{text}</span>
  </span>
}

export function conversationRailPreviewItems(items: readonly ConversationRailItem[]): NativeRailItem<ReactNode>[] {
  return items.map(item => ({ ...item,
    prompt: <ConversationRailPreview speaker={item.speaker} text={item.prompt || `第 ${item.turn} 条消息`} />,
    response: item.response === '' ? '' : <ConversationRailPreview speaker={item.responseSpeaker ?? item.speaker} text={item.response} response />,
  }))
}

/** Project existing rendered history only: no second history store or network read. */
export function readConversationRail(viewport: HTMLElement, turns: boolean): RailAnchor[] {
  const items: RailAnchor[] = []
  let previous: RailAnchor | undefined
  for (const element of viewport.querySelectorAll<HTMLElement>(ANCHOR)) {
    const key = element.dataset.arkmeWidthAnchor
    if (!key) continue
    const role = element.dataset.arkmeWidthRole
    if (role === 'divider') { previous = undefined; continue }
    const text = (element.dataset.arkmeWidthPreview || element.textContent || '').trim().slice(0, 320)
    if (turns && role === 'assistant' && previous) {
      previous.response = `${previous.response}${previous.response ? '\n' : ''}${text}`.slice(0, 320)
      previous.responseSpeaker ??= readSpeaker(element)
      continue
    }
    previous = { turn: items.length + 1, prompt: text, response: '', speaker: readSpeaker(element), anchor: { kind: 'loaded', key }, element }
    items.push(previous)
  }
  return items
}

export function conversationRailActive(viewport: HTMLElement, anchors: readonly RailAnchor[]): number | null {
  if (anchors.length === 0) return null
  if (viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight <= 2) return anchors.at(-1)!.turn
  const line = viewport.getBoundingClientRect().top + Math.min(80, viewport.clientHeight * .2)
  let active = anchors[0]!.turn
  for (const anchor of anchors) {
    if (anchor.element.getBoundingClientRect().top > line) break
    active = anchor.turn
  }
  return active
}

function readPreference(): number | null {
  try {
    const raw = localStorage.getItem(WIDE_CONVERSATION_WIDTH_KEY)
    const value = Number(raw)
    return raw !== null && Number.isFinite(value) && value > 0 ? value : null
  } catch { return null }
}

/** Capture an element, not scrollTop, so reflow does not move history under the reader. */
export function preserveConversationReading(viewport: HTMLElement, change: () => void): void {
  const bottom = viewport.scrollHeight - viewport.clientHeight - viewport.scrollTop <= 80
  const top = viewport.getBoundingClientRect().top
  const anchor = [...viewport.querySelectorAll<HTMLElement>(ANCHOR)].find(node => node.getBoundingClientRect().bottom > top)
  const offset = anchor?.getBoundingClientRect().top
  change()
  if (bottom) viewport.scrollTop = Math.max(0, viewport.scrollHeight - viewport.clientHeight)
  else if (anchor?.isConnected && offset !== undefined) viewport.scrollTop += anchor.getBoundingClientRect().top - offset
}

class NativeLayoutBoundary extends Component<{ children: ReactNode; onFailure(): void }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  componentDidCatch() { this.props.onFailure() }
  render() { return this.state.failed ? null : this.props.children }
}

/** Arkme supplies data/scroll anchors; actual handles, rail and appearance are native DSH. */
export function ArkmeWideConversation({ children, enabled, scopeKey, viewportRef, turns = false, controlsHidden = false }: {
  children: ReactNode
  enabled: boolean
  scopeKey: string
  viewportRef: RefObject<HTMLDivElement>
  turns?: boolean
  controlsHidden?: boolean
}) {
  const rootRef = useRef<HTMLDivElement>(null)
  const [column, setColumn] = useState(0)
  const [native, setNative] = useState<HarnessConversationLayout>()
  const [failed, setFailed] = useState(false)
  const wide = enabled && column > ARKME_WIDE_CONVERSATION_MIN && native !== undefined && !failed
  const preference = useRef<number | null>(null)
  const anchorsRef = useRef<RailAnchor[]>([])
  const [items, setItems] = useState<ConversationRailItem[]>([])
  const previewItems = useMemo(() => conversationRailPreviewItems(items), [items])
  const [activeTurn, setActiveTurn] = useState<number | null>(null)

  useLayoutEffect(() => {
    const root = rootRef.current
    if (!enabled || !root || typeof ResizeObserver === 'undefined') return
    preference.current = readPreference()
    const measure = () => {
      const width = root.clientWidth
      setColumn(previous => previous === width ? previous : width)
      root.style.setProperty('--dsh-conversation-column-width', `${width}px`)
      root.style.setProperty('--dsh-conversation-viewport-height', `${root.clientHeight}px`)
      root.style.setProperty('--dsh-composer-height', `${Math.max(0, root.clientHeight - (viewportRef.current?.clientHeight ?? root.clientHeight))}px`)
      if (native && preference.current !== null) {
        root.style.setProperty('--dsh-chat-user-width', `${native.resolveContentWidth(width, preference.current)}px`)
      }
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(root)
    if (viewportRef.current) observer.observe(viewportRef.current)
    return () => observer.disconnect()
  }, [enabled, native, scopeKey, viewportRef])

  useEffect(() => {
    if (!enabled || column <= ARKME_WIDE_CONVERSATION_MIN || native || failed) return
    let stopped = false
    void loadHarnessConversationLayout().then(value => {
      if (stopped) return
      if (value) setNative(value)
      else setFailed(true)
    })
    return () => { stopped = true }
  }, [column, enabled, failed, native])

  useLayoutEffect(() => {
    const viewport = viewportRef.current
    if (!wide || !viewport) return
    let frame: number | undefined
    let dirty = true
    let signature = ''
    const measure = () => {
      frame = undefined
      if (dirty) {
        dirty = false
        const anchors = readConversationRail(viewport, turns)
        anchorsRef.current = anchors
        const next = anchors.map(({ element: _element, ...item }) => item)
        const nextSignature = JSON.stringify(next)
        if (signature !== nextSignature) { signature = nextSignature; setItems(next) }
      }
      setActiveTurn(conversationRailActive(viewport, anchorsRef.current))
    }
    const schedule = () => { frame ??= requestAnimationFrame(measure) }
    const refresh = () => { dirty = true; schedule() }
    const observer = new MutationObserver(refresh)
    observer.observe(viewport, { childList: true, subtree: true, characterData: true, attributes: true,
      attributeFilter: ['data-arkme-width-preview', 'data-arkme-width-anchor', 'data-arkme-width-role',
        'data-arkme-width-sender', 'data-arkme-width-sender-kind', 'data-arkme-width-avatar'] })
    const resize = new ResizeObserver(schedule)
    resize.observe(viewport)
    const records = viewport.querySelector('ul')
    if (records) resize.observe(records)
    viewport.addEventListener('scroll', schedule, { passive: true })
    measure()
    return () => {
      observer.disconnect(); resize.disconnect(); viewport.removeEventListener('scroll', schedule)
      if (frame !== undefined) cancelAnimationFrame(frame)
      anchorsRef.current = []
    }
  }, [wide, scopeKey, turns, viewportRef])

  const navigate = useCallback((item: NativeRailItem<ReactNode>) => {
    const viewport = viewportRef.current
    const anchor = anchorsRef.current.find(candidate => candidate.anchor.key === item.anchor.key)
    if (!viewport || !anchor?.element.isConnected) return
    const top = viewport.scrollTop + anchor.element.getBoundingClientRect().top - viewport.getBoundingClientRect().top - 22
    // Instant positioning cannot drift into another row while older history prepends.
    viewport.scrollTo({ top: Math.max(0, top), behavior: 'instant' })
    setActiveTurn(item.turn)
  }, [viewportRef])
  const t = useCallback((key: string, params?: { turn: number }) => {
    if (key === 'chat.turnNavigation.label') return turns ? '对话轮次导航' : '消息位置导航'
    if (key === 'chat.turnNavigation.turn') return `第 ${params?.turn ?? ''} ${turns ? '轮对话' : '条消息'}`
    return `定位到第 ${params?.turn ?? ''} ${turns ? '轮对话' : '条消息'}`
  }, [turns])
  const failure = useCallback(() => setFailed(true), [])
  const resize = (width: number) => {
    const root = rootRef.current
    if (!root || !native) return
    const apply = () => root.style.setProperty('--dsh-chat-user-width', `${native.resolveContentWidth(root.clientWidth, width)}px`)
    if (viewportRef.current) preserveConversationReading(viewportRef.current, apply)
    else apply()
  }
  const start = () => native!.resolveContentWidth(rootRef.current!.clientWidth, preference.current)
  const commit = (width: number) => {
    if (!native || !rootRef.current) return
    preference.current = native.resolveContentWidth(rootRef.current.clientWidth, width)
    resize(preference.current)
    try { localStorage.setItem(WIDE_CONVERSATION_WIDTH_KEY, String(preference.current)) } catch { /* Presentation still works without durable storage. */ }
  }
  const end = () => {
    const root = rootRef.current
    if (!root) return
    if (preference.current === null) {
      const reset = () => root.style.removeProperty('--dsh-chat-user-width')
      if (viewportRef.current) preserveConversationReading(viewportRef.current, reset)
      else reset()
    }
    else resize(preference.current)
  }
  const shell: CSSProperties = enabled
    ? { position: 'relative', display: 'flex', flex: 1, flexDirection: 'column', minHeight: 0, minWidth: 0, height: 'auto' }
    : { display: 'contents' }
  return <div ref={rootRef} style={shell} className={wide ? native.rootClass : undefined}
    data-arkme-wide-conversation={wide ? 'true' : 'false'}>
    <style>{css}</style>
    {children}
    {wide && !controlsHidden && <NativeLayoutBoundary onFailure={failure}>
      {(['left', 'right'] as const).map(side => <native.WidthHandle key={side} side={side}
        onStart={start} onDrag={resize} onCommit={commit} onEnd={end} />)}
      {items.length > 0 && <div data-arkme-native-turn-rail style={{ position: 'absolute', inset: 0, pointerEvents: 'none', containerType: 'inline-size', zIndex: 9 }}>
        <div style={{ position: 'absolute', top: 0, left: 32, right: 32, height: 0 }}>
        <native.TurnNavigator items={previewItems} activeTurn={activeTurn} busyTurn={null} onNavigate={navigate} t={t} />
        </div>
      </div>}
    </NativeLayoutBoundary>}
  </div>
}
