import TourModule, { type TourProps } from '@rc-component/tour'
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import type { ArkmeAuthSnapshot } from '../types.js'
import { useTourAccount } from './use-tour-account.js'
import { arkmeCallTourSession, type ArkmeCallTourSession } from './call-tour-session.js'

const Tour = TourModule.default ?? TourModule
const overflow = { adjustX: true, adjustY: true, shiftX: 12, shiftY: 12 }
const placements: TourProps['builtinPlacements'] = {
  right: { points: ['cl', 'cr'], offset: [14, 0], overflow, autoArrow: true },
  left: { points: ['cr', 'cl'], offset: [-14, 0], overflow, autoArrow: true },
  top: { points: ['bc', 'tc'], offset: [0, -14], overflow, autoArrow: true },
  bottom: { points: ['tc', 'bc'], offset: [0, 14], overflow, autoArrow: true },
}
const steps = [
  { id: 'start', title: '发起一次通话', description: '点击这里，选择联系人，发起语音或视频通话。' },
  { id: 'types', title: '选择通话方式', description: '在联系人旁选择语音通话或视频通话，按你的需要开始交流。' },
  { id: 'recent', title: '查看最近通话', description: '这里展示最近的通话记录。点击一条记录，即可查看通话详情。' },
  { id: 'summary', title: '快速了解通话重点', description: '这是林小满的通话示例。AI 摘要会整理通话重点，方便你快速回顾。' },
  { id: 'video', title: '回顾视频记录', description: '这里展示视频通话记录，你还可以切换视角，回顾双方的画面。' },
  { id: 'utterance', title: '点击对话，回听语音', description: '通话会逐句转写为文字。点击这一条对话，就能播放对应的语音片段。' },
] as const

function visible(element: HTMLElement): boolean {
  if (!element.isConnected || element.closest('[hidden], [inert], [aria-hidden="true"]')) return false
  const rect = element.getBoundingClientRect()
  if (rect.width <= 0 || rect.height <= 0) return false
  for (let parent: HTMLElement | null = element; parent; parent = parent.parentElement) {
    const style = parent.ownerDocument.defaultView!.getComputedStyle(parent)
    if (style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse') return false
  }
  return true
}

function foregroundDocuments() {
  const docs = [document]
  for (const frame of document.querySelectorAll<HTMLIFrameElement>('iframe')) {
    if (!visible(frame)) continue
    try { if (frame.contentDocument?.body) docs.push(frame.contentDocument) } catch { /* Opaque frames are not inspectable. */ }
  }
  return docs
}

function blockedByOverlay(docs: Document[], owner: HTMLElement | null, step: number | undefined) {
  return document.body.hasAttribute('data-arkme-home-tour-running') || docs.some(doc =>
    [...doc.querySelectorAll<HTMLElement>('[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"], dialog[open], [data-arkme-notification-blocking-overlay="true"], [data-arkme-web-login-dialog="true"], [data-arkme-self-tour-running], [data-arkme-recording-tour-running], [data-arkme-home-tour-panel]')]
      .some(element => visible(element) && !(step === 1 && owner?.contains(element) && element.hasAttribute('data-arkme-call-tour-dialog'))))
}

function clippedRect(anchor: HTMLElement, owner: HTMLElement) {
  const rect = anchor.getBoundingClientRect()
  let left = Math.max(0, rect.left), right = Math.min(window.innerWidth, rect.right)
  let top = Math.max(0, rect.top), bottom = Math.min(window.innerHeight, rect.bottom)
  for (let parent = anchor.parentElement; parent; parent = parent.parentElement) {
    const style = window.getComputedStyle(parent), clip = parent.getBoundingClientRect()
    if (/auto|scroll|hidden|clip/.test(style.overflowX)) { left = Math.max(left, clip.left); right = Math.min(right, clip.right) }
    if (/auto|scroll|hidden|clip/.test(style.overflowY)) { top = Math.max(top, clip.top); bottom = Math.min(bottom, clip.bottom) }
    if (parent === owner) break
  }
  return { left, top, width: Math.max(0, right - left), height: Math.max(0, bottom - top) }
}

interface RunningTour { account: string; revision: number; step: number }
export interface CallTourOptions {
  root: RefObject<HTMLElement>
  auth: ArkmeAuthSnapshot | undefined
  active: boolean
  ready: boolean
  blocked: boolean
  explicitEntry: boolean
  notificationRevision: number
  onStep: (step: number) => void
  onExit: () => void
  session?: ArkmeCallTourSession
}

export function useCallTour({ root, auth, active, ready, blocked, explicitEntry, notificationRevision, onStep, onExit, session = arkmeCallTourSession }: CallTourOptions) {
  const account = useTourAccount(active ? auth : undefined)
  const maskId = useId()
  const [running, setRunning] = useState<RunningTour>()
  const [target, setTarget] = useState<HTMLElement>()
  const [spotlight, setSpotlight] = useState<ReturnType<typeof clippedRect>>()
  const [placement, setPlacement] = useState<'top' | 'bottom' | 'left' | 'right'>('right')
  const [geometryRevision, setGeometryRevision] = useState(0)
  const dispatchingMeasurement = useRef(false)
  const state = useRef(running); state.current = running
  const actions = useRef({ onStep, onExit }); actions.current = { onStep, onExit }
  const skippedVisit = useRef(false)
  const focusRequested = useRef(false)
  const finishRef = useRef<(restore?: boolean) => void>(() => { skippedVisit.current = true })
  const inspectRef = useRef<() => void>(() => {})
  const focusButton = useCallback((button: HTMLButtonElement | null) => {
    if (button && focusRequested.current) { focusRequested.current = false; button.focus({ preventScroll: true }) }
  }, [])
  useLayoutEffect(() => {
    if (!geometryRevision) return
    dispatchingMeasurement.current = true
    try { window.dispatchEvent(new Event('scroll')) } finally { dispatchingMeasurement.current = false }
  }, [geometryRevision])
  useEffect(() => {
    // An explicit action suppresses only this account's current visit.
    skippedVisit.current = active && explicitEntry
  }, [active, explicitEntry, auth?.userId, auth?.environment])

  useEffect(() => {
    state.current = undefined; setRunning(undefined); setTarget(undefined); setSpotlight(undefined)
    finishRef.current = () => { skippedVisit.current = true }
    if (!active || !ready || blocked || !account || explicitEntry || skippedVisit.current || typeof document === 'undefined') return
    let stopped = false, started = false, frame = 0
    let establishedStep: number | undefined
    let navigation: HTMLElement | undefined
    let returnFocus: HTMLElement | null = null
    let measurement: { node: HTMLElement; rect: string } | undefined
    const observers = new Map<Document, MutationObserver>()
    const frames = new Set<HTMLIFrameElement>()
    const resizeTargets = new Set<HTMLElement>()
    const resizeObserver = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(schedule)
    const blockedEvents = ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'click', 'dblclick', 'contextmenu', 'dragstart', 'dragover', 'drop', 'touchstart', 'wheel'] as const
    function stop() {
      stopped = true; cancelAnimationFrame(frame)
      observers.forEach(observer => observer.disconnect()); resizeObserver?.disconnect()
      frames.forEach(iframe => iframe.removeEventListener('load', schedule))
      window.removeEventListener('scroll', schedule, true); window.removeEventListener('resize', resize)
      window.removeEventListener('keydown', key, true); document.removeEventListener('visibilitychange', schedule)
      window.removeEventListener('focusin', keepFocus, true)
      blockedEvents.forEach(type => window.removeEventListener(type, blockOutside, true))
      if (started) { root.current?.removeAttribute('data-arkme-call-tour-running'); actions.current.onExit() }
    }
    function withdraw() {
      state.current = undefined; setRunning(undefined); setTarget(undefined); setSpotlight(undefined); stop()
    }
    function finish(restore = true) {
      skippedVisit.current = true
      if (!started || stopped) return
      session.finish(account!)
      const fallback = root.current?.querySelector<HTMLElement>('[data-arkme-call-tour-target="start"]')
      // Check before clearing the step so our own picker is still exempt, while
      // notifications, menus, and other dialogs retain their focus.
      const canRestore = restore && !blockedByOverlay(foregroundDocuments(), root.current, state.current?.step)
      withdraw()
      if (canRestore) {
        const element = returnFocus && visible(returnFocus) && returnFocus !== document.body ? returnFocus : fallback
        element?.focus({ preventScroll: true })
      }
    }
    finishRef.current = finish
    function ownsInteraction() {
      return started && !stopped && !blockedByOverlay(foregroundDocuments(), root.current, state.current?.step)
    }
    function tourPanel() { return document.querySelector<HTMLElement>('[data-arkme-call-tour-panel]') }
    function focusPrimary() { tourPanel()?.querySelector<HTMLButtonElement>('.arkme-home-tour-primary')?.focus({ preventScroll: true }) }
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
      if (!(event.target instanceof Node && panel?.contains(event.target))) {
        event.preventDefault(); event.stopImmediatePropagation(); focusPrimary(); return
      }
      if (event.key !== 'Tab') return
      const controls = [...panel.querySelectorAll<HTMLButtonElement>('button')]
        .filter(el => !el.matches(':disabled, [aria-disabled="true"]') && visible(el))
      if (!controls.length) return
      const index = controls.findIndex(control => control === document.activeElement)
      event.preventDefault()
      controls[(index + (event.shiftKey ? -1 : 1) + controls.length) % controls.length]?.focus({ preventScroll: true })
    }
    function schedule() { if (!stopped && !dispatchingMeasurement.current && !frame) frame = requestAnimationFrame(inspect) }
    function resize() { establishedStep = undefined; schedule() }
    function inspect() {
      frame = 0
      if (stopped) return
      const docs = foregroundDocuments()
      for (const [doc, observer] of observers) if (!docs.includes(doc)) { observer.disconnect(); observers.delete(doc) }
      for (const doc of docs) if (!observers.has(doc)) {
        const observer = new MutationObserver(schedule)
        observer.observe(doc.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['style', 'class', 'hidden', 'inert', 'aria-hidden', 'role', 'open', 'data-arkme-call-tour-target', 'data-arkme-home-tour-running', 'data-arkme-self-tour-running', 'data-arkme-recording-tour-running'] })
        observers.set(doc, observer)
      }
      for (const iframe of document.querySelectorAll<HTMLIFrameElement>('iframe')) if (!frames.has(iframe)) { frames.add(iframe); iframe.addEventListener('load', schedule) }
      const owner = root.current
      if (!owner || !visible(owner) || document.visibilityState === 'hidden' || (navigation && !visible(navigation)) || blockedByOverlay(docs, owner, state.current?.step)) { if (started) withdraw(); return }
      const step = state.current?.step ?? 0
      const anchor = owner.querySelector<HTMLElement>(`[data-arkme-call-tour-target="${steps[step]!.id}"]`)
      if (!anchor || !visible(anchor)) {
        if (started && establishedStep === step) withdraw()
        else { setTarget(undefined); setSpotlight(undefined) }
        return
      }
      if (establishedStep !== step) {
        // Reveal only within this surface, keeping the rest of the app stationary.
        for (let scroller = anchor.parentElement; scroller; scroller = scroller.parentElement) {
          if (scroller.clientHeight > 0 && scroller.scrollHeight > scroller.clientHeight && /auto|scroll/.test(window.getComputedStyle(scroller).overflowY)) {
            const clip = scroller.getBoundingClientRect(), rect = anchor.getBoundingClientRect()
            scroller.scrollTop += rect.top - clip.top - Math.max(12, (scroller.clientHeight - rect.height) / 2)
          }
          if (scroller === owner) break
        }
        establishedStep = step
      }
      const nextTargets = new Set<HTMLElement>([anchor, owner])
      for (let node: HTMLElement | null = anchor; node && node !== owner; node = node.parentElement) {
        nextTargets.add(node)
        if (node.previousElementSibling instanceof HTMLElement) nextTargets.add(node.previousElementSibling)
      }
      for (const node of resizeTargets) if (!nextTargets.has(node)) { resizeObserver?.unobserve(node); resizeTargets.delete(node) }
      for (const node of nextTargets) if (!resizeTargets.has(node)) { resizeObserver?.observe(node); resizeTargets.add(node) }
      const rect = clippedRect(anchor, owner)
      if (!rect.width || !rect.height) { setTarget(undefined); setSpotlight(undefined); return }
      if (!started) {
        if (!session.tryStart(account!)) { stop(); return }
        started = true; focusRequested.current = true
        returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
        navigation = [...document.querySelectorAll<HTMLElement>('[data-arkme-owned="product-navigation"]')].find(visible)
        owner.setAttribute('data-arkme-call-tour-running', 'true')
        const next = { account: account!, revision: notificationRevision, step: 0 }
        state.current = next; setRunning(next)
      }
      const geometry = JSON.stringify(anchor.getBoundingClientRect())
      if (measurement?.node === anchor && measurement.rect !== geometry) setGeometryRevision(value => value + 1)
      measurement = { node: anchor, rect: geometry }
      setSpotlight(previous => JSON.stringify(previous) === JSON.stringify(rect) ? previous : rect)
      setPlacement(window.innerWidth - rect.left - rect.width >= 340 ? 'right' : rect.left >= 340 ? 'left' : rect.top >= 240 ? 'top' : 'bottom')
      setTarget(previous => previous === anchor ? previous : anchor)
    }
    inspectRef.current = schedule
    window.addEventListener('scroll', schedule, true); window.addEventListener('resize', resize)
    window.addEventListener('keydown', key, true); document.addEventListener('visibilitychange', schedule)
    window.addEventListener('focusin', keepFocus, true)
    blockedEvents.forEach(type => window.addEventListener(type, blockOutside, { capture: true, passive: false }))
    schedule()
    return stop
  }, [root, account, active, ready, blocked, explicitEntry, notificationRevision, session])

  const valid = running && running.account === account && running.revision === notificationRevision && active && ready && !blocked && !explicitEntry
  const current = running?.step ?? 0
  const change = useCallback((step: number) => {
    if (!state.current || !steps[step]) return
    const next = { ...state.current, step }
    state.current = next; setRunning(next); setTarget(undefined); setSpotlight(undefined)
    focusRequested.current = true
    actions.current.onStep(step)
    inspectRef.current()
  }, [])
  const finish = useCallback((restore = true) => finishRef.current(restore), [])
  const panel = valid && target && spotlight ? createPortal(<div data-arkme-call-tour-viewport style={{ position: 'fixed', inset: 0, zIndex: 100100, pointerEvents: 'none' }}>
    <svg aria-hidden="true" width="100%" height="100%" style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
      <defs><mask id={maskId}><rect width="100%" height="100%" fill="white" /><rect x={spotlight.left} y={spotlight.top} width={spotlight.width} height={spotlight.height} fill="black" /></mask></defs>
      <rect width="100%" height="100%" fill="rgba(0,0,0,.5)" mask={`url(#${maskId})`} />
      <rect data-arkme-call-tour-mask-blocker width="100%" height="100%" fill="transparent" style={{ pointerEvents: 'auto' }} />
      <rect data-arkme-call-tour-spotlight={steps[current]!.id} x={spotlight.left} y={spotlight.top} width={spotlight.width} height={spotlight.height} rx={8} fill="none" stroke="var(--arkme-accent, #8674ee)" strokeWidth={2} />
    </svg>
    <Tour open current={0} prefixCls="arkme-home-tour" getPopupContainer={false} mask={false} disabledInteraction={false} keyboard={false} scrollIntoViewOptions={false} arrow={{ pointAtCenter: true }} placement={placement} builtinPlacements={placements} zIndex={100100}
      steps={[{ ...steps[current]!, target, scrollIntoViewOptions: false }]}
      renderPanel={() => <section className="arkme-home-tour-panel" data-arkme-call-tour-panel role="region" aria-label="通话体验引导" style={{ pointerEvents: 'auto', maxWidth: 'calc(100vw - 24px)' }}>
        <div className="arkme-home-tour-header"><span className="arkme-home-tour-progress" aria-live="polite">{current + 1} / 6</span><button type="button" className="arkme-home-tour-close" aria-label="关闭通话引导" onClick={() => finish()}>×</button></div>
        <h2>{steps[current]!.title}</h2><p>{steps[current]!.description}</p>
        <div className="arkme-home-tour-actions"><button type="button" className="arkme-home-tour-skip" onClick={() => finish()}>跳过引导</button><div className="arkme-home-tour-navigation">{current > 0 && <button type="button" onClick={() => change(current - 1)}>上一步</button>}<button ref={focusButton} type="button" className="arkme-home-tour-primary" onClick={() => current === 5 ? finish() : change(current + 1)}>{current === 5 ? '完成引导' : '下一步'}</button></div></div>
      </section>} />
  </div>, document.body) : null
  return { current: valid ? current : undefined, panel, change, finish }
}
