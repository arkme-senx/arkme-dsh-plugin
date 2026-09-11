import TourModule, { type TourProps } from '@rc-component/tour'
import { useEffect, useId, useLayoutEffect, useRef, useState, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import type { ArkmeAuthSnapshot } from '../types.js'
import { arkmeSendToSelfTourSession, type ArkmeSendToSelfTourSession } from './send-to-self-tour-session.js'
import { useTourAccount } from './use-tour-account.js'

const Tour = TourModule.default ?? TourModule
const steps = [
  { id: 'composer', title: '随手记录，发给自己', description: '在这里记下想法、灵感和待办。点击「＋」添加照片和文件，也可以写长文，保存完整思路。' },
  { id: 'topics', title: '用主题整理内容', description: '在这里随时切换主题，查看不同主题下的记录。点击「创建主题」，为工作、生活或灵感分类。' },
] as const
const overflow = { adjustX: true, adjustY: true, shiftX: 12, shiftY: 12 }
const placements: TourProps['builtinPlacements'] = {
  right: { points: ['cl', 'cr'], offset: [14, 0], overflow, autoArrow: true },
  left: { points: ['cr', 'cl'], offset: [-14, 0], overflow, autoArrow: true },
  top: { points: ['bc', 'tc'], offset: [0, -14], overflow, autoArrow: true },
  bottom: { points: ['tc', 'bc'], offset: [0, 14], overflow, autoArrow: true },
}
type Step = 0 | 1
interface RunningTour { account: string; revision: number; step: Step }
interface Spotlight { left: number; top: number; width: number; height: number }

function visible(element: HTMLElement): boolean {
  if (!element.isConnected || element.closest('[hidden], [inert], [aria-hidden="true"]')) return false
  const rect = element.getBoundingClientRect()
  if (rect.width <= 0 || rect.height <= 0) return false
  for (let node: HTMLElement | null = element; node; node = node.parentElement) {
    const style = node.ownerDocument.defaultView!.getComputedStyle(node)
    if (style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse') return false
  }
  return true
}

function foregroundDocuments(): Document[] {
  const documents = [document]
  for (const frame of document.querySelectorAll<HTMLIFrameElement>('iframe')) {
    if (!visible(frame)) continue
    try { if (frame.contentDocument?.body) documents.push(frame.contentDocument) }
    catch { /* Cross-origin frames are opaque. */ }
  }
  return documents
}

function hasOtherOverlay(documents: Document[], owner: HTMLElement | null, started: boolean): boolean {
  if (document.body.hasAttribute('data-arkme-home-tour-running')) return true
  return documents.some(doc => [...doc.querySelectorAll<HTMLElement>(
    '[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"], dialog[open], [data-arkme-notification-blocking-overlay="true"], [data-arkme-web-login-dialog="true"], [data-arkme-call-tour-running], [data-arkme-recording-tour-running], [data-arkme-self-topic-menu], [data-arkme-self-tour-running]',
  )].some(element => {
    if (element.closest('[data-arkme-self-tour-panel]')) return false
    if (element === owner || (started && element.hasAttribute('data-arkme-self-topic-menu') && owner?.contains(element))) return false
    return visible(element)
  }))
}

function spotlightAround(elements: HTMLElement[]): Spotlight {
  const rects = elements.map(element => element.getBoundingClientRect())
  const left = Math.max(0, Math.min(...rects.map(rect => rect.left)) - 6)
  const top = Math.max(0, Math.min(...rects.map(rect => rect.top)) - 6)
  const right = Math.min(window.innerWidth, Math.max(...rects.map(rect => rect.right)) + 6)
  const bottom = Math.min(window.innerHeight, Math.max(...rects.map(rect => rect.bottom)) + 6)
  return { left, top, width: Math.max(0, right - left), height: Math.max(0, bottom - top) }
}

function SendToSelfTourPanel({ current, onPrevious, onNext, onDismiss }: {
  current: Step
  onPrevious(): void
  onNext(): void
  onDismiss(): void
}) {
  const primaryRef = useRef<HTMLButtonElement>(null)
  useLayoutEffect(() => { primaryRef.current?.focus({ preventScroll: true }) }, [current])
  return <section className="arkme-home-tour-panel" data-arkme-self-tour-panel role="dialog" aria-modal="true"
    aria-label="发给自己引导" aria-describedby="arkme-self-tour-description">
    <div className="arkme-home-tour-header">
      <span className="arkme-home-tour-progress" aria-live="polite">{current + 1} / 2</span>
      <button type="button" className="arkme-home-tour-close" aria-label="关闭发给自己引导" onClick={onDismiss}>×</button>
    </div>
    <h2>{steps[current]!.title}</h2><p id="arkme-self-tour-description">{steps[current]!.description}</p>
    <div className="arkme-home-tour-actions">
      <button type="button" className="arkme-home-tour-skip" onClick={onDismiss}>跳过引导</button>
      <div className="arkme-home-tour-navigation">
        {current === 1 && <button type="button" onClick={onPrevious}>上一步</button>}
        <button ref={primaryRef} type="button" className="arkme-home-tour-primary" onClick={onNext}>{current === 1 ? '开始使用' : '下一步'}</button>
      </div>
    </div>
  </section>
}

export interface SendToSelfTourOptions {
  root: RefObject<HTMLElement>
  composer: RefObject<{ focus(options?: FocusOptions): void }>
  auth: ArkmeAuthSnapshot | undefined
  active: boolean
  blocked: boolean
  deepLink: boolean
  notificationRevision: number
  session?: ArkmeSendToSelfTourSession
}

export function useSendToSelfTour({ root, composer, auth, active, blocked, deepLink, notificationRevision,
  session = arkmeSendToSelfTourSession }: SendToSelfTourOptions) {
  const account = useTourAccount(active ? auth : undefined)
  const maskId = useId()
  const [running, setRunning] = useState<RunningTour>()
  const state = useRef(running)
  state.current = running
  const [target, setTarget] = useState<HTMLElement>()
  const [spotlight, setSpotlight] = useState<Spotlight>()
  const [placement, setPlacement] = useState<'top' | 'bottom' | 'left' | 'right'>('top')
  const [geometryRevision, setGeometryRevision] = useState(0)
  const dispatchingMeasurement = useRef(false)
  const finishRef = useRef<(restore?: boolean) => void>(() => {})
  const inspectRef = useRef<() => void>(() => {})
  const skippedVisit = useRef(false)
  useEffect(() => {
    if (!active) skippedVisit.current = false
    else if (deepLink) skippedVisit.current = true
  }, [active, deepLink])
  useLayoutEffect(() => {
    if (geometryRevision === 0) return
    dispatchingMeasurement.current = true
    try { window.dispatchEvent(new Event('scroll')) }
    finally { dispatchingMeasurement.current = false }
  }, [geometryRevision])

  useEffect(() => {
    state.current = undefined; setRunning(undefined); setTarget(undefined); setSpotlight(undefined)
    if (!active || blocked || !account || deepLink || skippedVisit.current || typeof document === 'undefined') return
    let frame = 0, stopped = false, started = false
    let establishedStep: Step | undefined
    let measurement: Spotlight | undefined
    let measuredTarget: HTMLElement | undefined
    const owner = root.current
    const observers = new Map<Document, MutationObserver>()
    const frameListeners = new Map<HTMLIFrameElement, () => void>()
    const resizeObserver = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(schedule)
    const resizeTargets = new Set<HTMLElement>()
    const blockedEvents = ['pointerdown', 'mousedown', 'click', 'dblclick', 'contextmenu', 'dragstart', 'dragover', 'drop', 'touchstart'] as const
    const stop = () => {
      stopped = true; cancelAnimationFrame(frame)
      if (started) owner?.removeAttribute('data-arkme-self-tour-running')
      owner?.style.removeProperty('--arkme-self-tour-menu-max-height')
      observers.forEach(observer => observer.disconnect()); observers.clear()
      frameListeners.forEach((listener, iframe) => iframe.removeEventListener('load', listener)); frameListeners.clear()
      resizeObserver?.disconnect()
      window.removeEventListener('scroll', schedule, true); window.removeEventListener('resize', schedule)
      window.removeEventListener('keydown', key, true); document.removeEventListener('visibilitychange', schedule)
      window.removeEventListener('focusin', keepFocus, true)
      blockedEvents.forEach(type => window.removeEventListener(type, blockOutside, true))
    }
    const withdraw = () => {
      state.current = undefined; setRunning(undefined); setTarget(undefined); setSpotlight(undefined); stop()
    }
    const finish = (restore = true) => {
      if (!started || stopped) return
      const step = state.current?.step
      session.finish(account)
      withdraw()
      if (restore && owner && visible(owner) && !hasOtherOverlay(foregroundDocuments(), owner, true)) {
        if (step === 1) owner.querySelector<HTMLButtonElement>('[data-arkme-self-topic-selector]')?.focus({ preventScroll: true })
        else composer.current?.focus({ preventScroll: true })
      }
    }
    finishRef.current = finish
    function ownsInteraction(): boolean {
      return started && !stopped && !hasOtherOverlay(foregroundDocuments(), owner, true)
    }
    function tourPanel(): HTMLElement | null {
      return document.querySelector<HTMLElement>('[data-arkme-self-tour-panel]')
    }
    function focusPrimary() {
      tourPanel()?.querySelector<HTMLButtonElement>('.arkme-home-tour-primary')?.focus({ preventScroll: true })
    }
    function blockOutside(event: Event) {
      if (!ownsInteraction() || (event.target instanceof Node && tourPanel()?.contains(event.target))) return
      event.preventDefault(); event.stopImmediatePropagation()
    }
    function keepFocus(event: FocusEvent) {
      if (!ownsInteraction() || (event.target instanceof Node && tourPanel()?.contains(event.target))) return
      event.stopImmediatePropagation(); focusPrimary()
    }
    function key(event: KeyboardEvent) {
      if (!ownsInteraction()) return
      if (event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); finish(); return }
      const panel = tourPanel()
      const outside = !(event.target instanceof Node && panel?.contains(event.target))
      if (outside) { event.preventDefault(); event.stopImmediatePropagation(); focusPrimary(); return }
      if (event.key !== 'Tab') return
      const buttons = panel?.querySelectorAll<HTMLButtonElement>('button')
      const first = buttons?.[0], last = buttons?.[buttons.length - 1]
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
    }
    function schedule() {
      if (!stopped && !dispatchingMeasurement.current && frame === 0) frame = requestAnimationFrame(inspect)
    }
    function inspect() {
      frame = 0
      if (stopped) return
      const documents = foregroundDocuments()
      for (const [doc, observer] of observers) if (!documents.includes(doc)) { observer.disconnect(); observers.delete(doc) }
      for (const doc of documents) if (!observers.has(doc) && doc.body) {
        const observer = new MutationObserver(schedule)
        observer.observe(doc.body, { subtree: true, childList: true, attributes: true,
          attributeFilter: ['style', 'class', 'hidden', 'inert', 'aria-hidden', 'role', 'open', 'disabled', 'contenteditable', 'data-arkme-home-tour-running', 'data-arkme-self-tour-running', 'data-arkme-recording-tour-running', 'data-arkme-call-tour-running'] })
        observers.set(doc, observer)
      }
      for (const iframe of document.querySelectorAll<HTMLIFrameElement>('iframe')) if (!frameListeners.has(iframe)) {
        iframe.addEventListener('load', schedule); frameListeners.set(iframe, schedule)
      }
      if (!owner || !visible(owner) || document.visibilityState === 'hidden' || hasOtherOverlay(documents, owner, started)) {
        if (started) withdraw()
        return
      }
      const step = state.current?.step ?? 0
      const input = owner.querySelector<HTMLElement>('[data-arkme-primary-composer]')
      const selector = owner.querySelector<HTMLButtonElement>('[data-arkme-self-topic-selector]')
      const menu = owner.querySelector<HTMLElement>('[data-arkme-self-topic-menu]')
      const anchor = step === 0 ? input : menu
      if (!anchor || !visible(anchor) || !selector || !visible(selector)
        || (step === 0 && (!composer.current || !input?.querySelector('[contenteditable="true"], textarea:not([disabled])')))) {
        if (started && establishedStep === step) withdraw()
        else { setTarget(undefined); setSpotlight(undefined) }
        return
      }
      const elements = step === 0 ? [anchor] : [selector, anchor]
      const panel = document.querySelector<HTMLElement>('[data-arkme-self-tour-panel]')
      const menuRect = menu?.getBoundingClientRect()
      const menuNeedsVerticalSpace = step === 1 && menuRect !== undefined
        && window.innerWidth - menuRect.right < 348 && menuRect.left < 348
      if (menuNeedsVerticalSpace) {
        // Leave space below a long topic list for the guide, while the real list
        // remains scrollable and its fixed create button stays visible.
        const panelHeight = panel?.getBoundingClientRect().height ?? 250
        const maxHeight = `${Math.floor(Math.max(120, window.innerHeight - menuRect.top - panelHeight - 40))}px`
        if (owner.style.getPropertyValue('--arkme-self-tour-menu-max-height') !== maxHeight) {
          owner.style.setProperty('--arkme-self-tour-menu-max-height', maxHeight)
        }
      } else owner.style.removeProperty('--arkme-self-tour-menu-max-height')
      const nextSpotlight = spotlightAround(elements)
      if (nextSpotlight.width <= 0 || nextSpotlight.height <= 0) {
        if (started) withdraw()
        else { setTarget(undefined); setSpotlight(undefined) }
        return
      }
      if (!started) {
        if (!session.tryStart(account!)) { stop(); return }
        started = true
        owner.setAttribute('data-arkme-self-tour-running', 'true')
        const next = { account: account!, revision: notificationRevision, step: 0 as const }
        state.current = next; setRunning(next)
      }
      establishedStep = step
      const nextResizeTargets = new Set([owner, ...elements])
      if (panel) nextResizeTargets.add(panel)
      for (const node of resizeTargets) if (!nextResizeTargets.has(node)) { resizeObserver?.unobserve(node); resizeTargets.delete(node) }
      for (const node of nextResizeTargets) if (!resizeTargets.has(node)) { resizeObserver?.observe(node); resizeTargets.add(node) }
      const rect = anchor.getBoundingClientRect()
      const nextMeasurement = { left: rect.left, top: rect.top, width: rect.width, height: rect.height }
      if (measuredTarget === anchor && JSON.stringify(measurement) !== JSON.stringify(nextMeasurement)) setGeometryRevision(value => value + 1)
      measuredTarget = anchor; measurement = nextMeasurement
      setSpotlight(previous => JSON.stringify(previous) === JSON.stringify(nextSpotlight) ? previous : nextSpotlight)
      setTarget(anchor)
      setPlacement(step === 0 ? (rect.top >= 260 ? 'top' : 'bottom')
        : menuNeedsVerticalSpace ? 'bottom'
        : window.innerWidth - rect.right >= 348 ? 'right' : rect.left >= 348 ? 'left'
          : window.innerHeight - rect.bottom >= 260 ? 'bottom' : 'top')
    }
    inspectRef.current = schedule
    window.addEventListener('scroll', schedule, true); window.addEventListener('resize', schedule)
    window.addEventListener('keydown', key, true); document.addEventListener('visibilitychange', schedule)
    window.addEventListener('focusin', keepFocus, true)
    blockedEvents.forEach(type => window.addEventListener(type, blockOutside, { capture: true, passive: false }))
    schedule()
    return stop
  }, [root, composer, account, active, blocked, deepLink, notificationRevision, session])

  const valid = running !== undefined && running.account === account && running.revision === notificationRevision
    && active && !blocked && !deepLink
  const current = running?.step ?? 0
  const change = (step: Step) => {
    if (!state.current) return
    const next = { ...state.current, step }
    state.current = next; setRunning(next); setTarget(undefined); setSpotlight(undefined); inspectRef.current()
  }
  const finish = (restore = true) => finishRef.current(restore)
  const panel = valid && target && spotlight ? createPortal(
    <div data-arkme-self-tour-viewport style={{ position: 'fixed', inset: 0, zIndex: 100100, pointerEvents: 'none' }}>
      <svg aria-hidden="true" width="100%" height="100%" style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
        <defs><mask id={maskId}><rect width="100%" height="100%" fill="white" />
          <rect x={spotlight.left} y={spotlight.top} width={spotlight.width} height={spotlight.height} rx={10} fill="black" />
        </mask></defs>
        <rect width="100%" height="100%" fill="rgba(0,0,0,.5)" mask={`url(#${maskId})`} />
        <rect data-arkme-self-tour-mask-blocker width="100%" height="100%" fill="transparent" style={{ pointerEvents: 'auto' }} />
        <rect data-arkme-self-tour-spotlight={steps[current]!.id} x={spotlight.left} y={spotlight.top}
          width={spotlight.width} height={spotlight.height} rx={10} fill="none" stroke="var(--arkme-accent, #8674ee)" strokeWidth={2} />
      </svg>
      <Tour open current={0} prefixCls="arkme-home-tour" getPopupContainer={false} mask={false} disabledInteraction={false}
        keyboard={false} scrollIntoViewOptions={false} arrow={{ pointAtCenter: true }} placement={placement} builtinPlacements={placements} zIndex={100100}
        steps={[{ ...steps[current]!, target, scrollIntoViewOptions: false }]}
        renderPanel={() => <SendToSelfTourPanel current={current} onPrevious={() => change(0)}
          onNext={() => current === 1 ? finish() : change(1)} onDismiss={() => finish()} />} />
    </div>, document.body,
  ) : null
  return { panel, topicMenuOpen: valid ? current === 1 : undefined }
}
