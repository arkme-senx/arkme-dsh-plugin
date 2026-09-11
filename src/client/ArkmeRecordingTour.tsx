import TourModule, { type TourProps } from '@rc-component/tour'
import { useCallback, useEffect, useLayoutEffect, useId, useRef, useState, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import type { ArkmeAuthSnapshot } from '../types.js'
import { useTourAccount } from './use-tour-account.js'
import { arkmeRecordingTourSession, type ArkmeRecordingTourSession } from './recording-tour-session.js'
const Tour = TourModule.default ?? TourModule
const overflow = { adjustX: true, adjustY: true, shiftX: 12, shiftY: 12 }
const placements: TourProps['builtinPlacements'] = {
 right: { points: ['cl','cr'], offset: [14,0], overflow, autoArrow: true },
 left: { points: ['cr','cl'], offset: [-14,0], overflow, autoArrow: true },
 bottom: { points: ['tc','bc'], offset: [0,14], overflow, autoArrow: true },
 top: { points: ['bc','tc'], offset: [0,-54], overflow, autoArrow: true },
}
const samplePlacements: TourProps['builtinPlacements'] = { ...placements, top: { points: ['bc','tc'], offset: [0,-14], overflow: { adjustX: true, shiftX: 12, adjustY: false, shiftY: false }, autoArrow: true } }
const steps = [
 { id: 'import', title: '导入历史音频', description: '把已有音频文件导入 Arkme，统一管理和回顾。' },
 { id: 'tabs', title: '体验录音内容', description: '切换 Tab，体验逐句转写、重点总结和关键事件时间轴。' },
 { id: 'calendar', title: '录音日历', description: '选择日期查看当天录音，有录音的日期会显示时长标记。' },
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
function clippedViewportRect(anchor: HTMLElement, owner: HTMLElement) {
 const rect = anchor.getBoundingClientRect()
 let left = Math.max(0, rect.left), right = Math.min(window.innerWidth, rect.right)
 let top = Math.max(0, rect.top), bottom = Math.min(window.innerHeight, rect.bottom)
 for (let parent = anchor.parentElement; parent; parent = parent.parentElement) {
  const style = window.getComputedStyle(parent)
  const clip = parent.getBoundingClientRect()
  if (/auto|scroll|hidden|clip/.test(style.overflowX)) { left = Math.max(left,clip.left); right = Math.min(right,clip.right) }
  if (/auto|scroll|hidden|clip/.test(style.overflowY)) { top = Math.max(top,clip.top); bottom = Math.min(bottom,clip.bottom) }
  if (parent === owner) break
 }
 return { left, top, width: Math.max(0,right-left), height: Math.max(0,bottom-top) }
}
function withinVisibleViewport(anchor: HTMLElement, owner: HTMLElement): boolean {
 const rect = clippedViewportRect(anchor,owner)
 return rect.width > 0 && rect.height > 0
}
function foregroundDocuments() {
 const docs = [document]
 for (const frame of document.querySelectorAll<HTMLIFrameElement>('iframe')) {
  if (!visible(frame)) continue
  try { if (frame.contentDocument?.body) docs.push(frame.contentDocument) } catch { /* Opaque cross-origin frames cannot be inspected. */ }
 }
 return docs
}
function blockedByOverlay(docs: Document[]) {
 return document.body.hasAttribute('data-arkme-home-tour-running') || docs.some(doc => [...doc.querySelectorAll<HTMLElement>('[data-arkme-call-tour-running], [role="dialog"], [role="alertdialog"], [role="menu"], dialog[open], [data-arkme-notification-blocking-overlay="true"], [data-arkme-web-login-dialog="true"], [data-arkme-home-tour-panel]')].some(visible))
}
export interface RecordingTourOptions {
 root: RefObject<HTMLElement>
 auth: ArkmeAuthSnapshot | undefined
 active: boolean
 blocked: boolean
 deepLink: boolean
 notificationRevision: number
 session?: ArkmeRecordingTourSession
}
interface Spotlight { id: string; left: number; top: number; width: number; height: number }
interface RunningTour { account: string; revision: number; step: number }
export function useRecordingTour({ root, auth, active, blocked, deepLink, notificationRevision, session = arkmeRecordingTourSession }: RecordingTourOptions) {
 const account = useTourAccount(auth)
 const maskId = useId()
 const [spotlights, setSpotlights] = useState<Spotlight[]>([])
 const panelHeight = useRef(208)
 const [running, setRunning] = useState<RunningTour>()
 const [target, setTarget] = useState<HTMLElement>()
 const [geometryRevision, setGeometryRevision] = useState(0)
 const dispatchingMeasurement = useRef(false)
 useLayoutEffect(() => {
  if (geometryRevision === 0) return
  // The first notification updates rc-tour's placeholder. Align rc-trigger only
  // after that new placeholder geometry has actually committed to the DOM.
  dispatchingMeasurement.current = true
  try { window.dispatchEvent(new Event('scroll')) } finally { dispatchingMeasurement.current = false }
 }, [geometryRevision])
 const [placement, setPlacement] = useState<'top' | 'bottom' | 'right' | 'left'>('right')
 const state = useRef(running); state.current = running
 const returnFocus = useRef<HTMLElement | null>(null)
 const focusRequested = useRef(false)
 const focusTourButton = useCallback((button: HTMLButtonElement | null) => {
  if (button !== null && focusRequested.current) {
   focusRequested.current = false
   button.focus({ preventScroll: true })
  }
 }, [])
 const skippedVisit = useRef(false)
 const finishRef = useRef<(restore?: boolean) => void>(() => {})
 const inspectRef = useRef<() => void>(() => {})
 // Explicit navigation has priority for the whole visit, even when its target is consumed.
 useEffect(() => { if (!active) skippedVisit.current = false; else if (deepLink) skippedVisit.current = true }, [active, deepLink])
 useEffect(() => {
  setRunning(undefined); setTarget(undefined); setSpotlights([])
  if (!active || blocked || account === undefined || deepLink || skippedVisit.current || typeof document === 'undefined') return
  let frame = 0, stopped = false, started = false
  const observers = new Map<Document, MutationObserver>()
  const frameListeners = new Map<HTMLIFrameElement, () => void>()
  const resizeObserver = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(schedule)
  const resizeTargets = new Set<HTMLElement>()
  let measurement: { node: HTMLElement; left: number; top: number; width: number; height: number } | undefined
  let highlighted: HTMLElement | undefined
  let establishedStep: number | undefined
  let navigation: HTMLElement | undefined
  const clearHighlight = () => { highlighted?.removeAttribute('data-arkme-recording-tour-highlight'); highlighted = undefined }
  const stop = () => {
   stopped = true; cancelAnimationFrame(frame); clearHighlight(); if (started) root.current?.removeAttribute('data-arkme-recording-tour-running'); root.current?.style.removeProperty('--arkme-recording-tour-sample-offset')
   observers.forEach(o => o.disconnect()); observers.clear()
   resizeObserver?.disconnect(); resizeTargets.clear()
   frameListeners.forEach((listener, el) => el.removeEventListener('load', listener)); frameListeners.clear()
   window.removeEventListener('resize', revealAfterResize); window.removeEventListener('scroll', schedule, true)
   window.removeEventListener('keydown', key, true); document.removeEventListener('visibilitychange', schedule)
  }
  const withdraw = () => { state.current = undefined; setRunning(undefined); setTarget(undefined); stop() }
  const finish = (restore = true) => {
   if (!started || stopped) return
   session.finish(account)
   const focused = document.activeElement
   const shouldRestore = restore && focused instanceof Element && !!focused.closest('[data-arkme-recording-tour-panel], [data-arkme-recording-tour-sample]')
   withdraw()
   if (shouldRestore && returnFocus.current && visible(returnFocus.current) && !blockedByOverlay(foregroundDocuments())) returnFocus.current.focus({ preventScroll: true })
  }
  finishRef.current = finish
  function key(event: KeyboardEvent) {
   if (event.key === 'Escape' && started && !blockedByOverlay(foregroundDocuments())) { event.preventDefault(); event.stopImmediatePropagation(); finish() }
  }
  function revealAfterResize() {
   // Reflow can move the example entirely below the viewport. Reveal once for
   // this viewport change; ordinary nested scrolling never resets this guard.
   establishedStep = undefined
   root.current?.style.removeProperty('--arkme-recording-tour-sample-offset')
   schedule()
  }
  function schedule() { if (!stopped && !dispatchingMeasurement.current && frame === 0) frame = requestAnimationFrame(inspect) }
  function inspect() {
   frame = 0
   if (stopped) return
   const docs = foregroundDocuments()
   for (const [doc, observer] of observers) if (!docs.includes(doc)) { observer.disconnect(); observers.delete(doc) }
   for (const doc of docs) if (!observers.has(doc) && doc.body) {
    const observer = new MutationObserver(schedule)
    observer.observe(doc.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['style','class','hidden','inert','aria-hidden','role','open','data-arkme-recording-tour-target','data-arkme-home-tour-running','data-arkme-call-tour-running'] })
    observers.set(doc,observer)
   }
   for (const iframe of document.querySelectorAll<HTMLIFrameElement>('iframe')) if (!frameListeners.has(iframe)) { iframe.addEventListener('load',schedule); frameListeners.set(iframe,schedule) }
   const owner = root.current
   if (document.visibilityState === 'hidden' || !owner || !visible(owner) || (navigation !== undefined && !visible(navigation)) || blockedByOverlay(docs)) { if (started) withdraw(); return }
   const step = state.current?.step ?? 0
   const sample = owner.querySelector<HTMLElement>('[data-arkme-recording-tour-sample]')
   const el = step === 1 ? sample : owner.querySelector<HTMLElement>(`[data-arkme-recording-tour-target="${steps[step]!.id}"]`)
   // A newly selected step may still be mounting. No popup until it has a real target.
   if (!el || !visible(el)) { if (started && establishedStep === step) withdraw(); else { clearHighlight(); setTarget(undefined) }; return }
   if (establishedStep !== step) {
    // Reveal the import inside the calendar's own scroller, then reveal that scroller
    // inside the recording surface. Never scroll any ancestor outside this owner.
    for (let scroller = el.parentElement; scroller; scroller = scroller.parentElement) {
     if (scroller.scrollHeight > scroller.clientHeight && scroller.clientHeight > 0 && /auto|scroll/.test(window.getComputedStyle(scroller).overflowY)) {
      const ownerRect = scroller.getBoundingClientRect()
      const targetRect = el.getBoundingClientRect()
      if (scroller === owner && step === 1) scroller.scrollTop += targetRect.top - (Math.max(0,ownerRect.top) + panelHeight.current + 32)
      else if (targetRect.top < ownerRect.top + 8) scroller.scrollTop += targetRect.top - ownerRect.top - 8
      else if (targetRect.bottom > ownerRect.bottom - 8) scroller.scrollTop += targetRect.bottom - ownerRect.bottom + 8
     }
     if (scroller === owner) break
    }
   }
   const sampleClearanceTop = Math.max(0,owner.getBoundingClientRect().top) + panelHeight.current + 32
   if (step === 1 && establishedStep !== step && el.getBoundingClientRect().top < sampleClearanceTop) {
    const previousOffset = parseFloat(owner.style.getPropertyValue('--arkme-recording-tour-sample-offset')) || 0
    owner.style.setProperty('--arkme-recording-tour-sample-offset', `${previousOffset + sampleClearanceTop - el.getBoundingClientRect().top}px`)
   }
   establishedStep = step
   const anchor = el
   // Observe only the target's layout path and preceding siblings (e.g. real upper
   // timeline), rather than every transcript row in a potentially large day.
   const nextResizeTargets = new Set<HTMLElement>([anchor,owner])
   for (let node: HTMLElement | null = anchor; node && node !== owner; node = node.parentElement) {
    nextResizeTargets.add(node)
    if (node.previousElementSibling instanceof HTMLElement) nextResizeTargets.add(node.previousElementSibling)
   }
   for (const node of resizeTargets) if (!nextResizeTargets.has(node)) { resizeObserver?.unobserve(node); resizeTargets.delete(node) }
   for (const node of nextResizeTargets) if (!resizeTargets.has(node)) { resizeObserver?.observe(node); resizeTargets.add(node) }
   if (!withinVisibleViewport(anchor,owner) || (step === 1 && anchor.getBoundingClientRect().top < sampleClearanceTop - 8)) { clearHighlight(); setTarget(undefined); return }
   const nextSpotlights = [{ id: step === 1 ? 'sample' : steps[step]!.id, ...clippedViewportRect(el,owner) }]
   setSpotlights(previous => JSON.stringify(previous) === JSON.stringify(nextSpotlights) ? previous : nextSpotlights)
   if (!started) {
    if (!session.tryStart(account!)) { stop(); return }
    started = true
    focusRequested.current = true
    owner.setAttribute('data-arkme-recording-tour-running','true')
    navigation = [...document.querySelectorAll<HTMLElement>('[data-arkme-owned="product-navigation"]')].find(visible)
    returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const next = { account: account!, revision: notificationRevision, step: 0 }
    state.current = next; setRunning(next)
   }
   if (highlighted !== el) { clearHighlight(); highlighted = el; el.setAttribute('data-arkme-recording-tour-highlight','true') }
   const rect = anchor.getBoundingClientRect()
   const previous = measurement
   measurement = { node: anchor, left: rect.left, top: rect.top, width: rect.width, height: rect.height }
   if (previous?.node === anchor && (previous.left !== rect.left || previous.top !== rect.top || previous.width !== rect.width || previous.height !== rect.height)) {
    // rc-tour listens only to window scroll/resize. Forward actual same-node geometry
    // changes from nested scroll or late layout, without recursively scheduling ourselves.
    dispatchingMeasurement.current = true
    try { window.dispatchEvent(new Event('scroll')) } finally { dispatchingMeasurement.current = false }
    setGeometryRevision(value => value + 1)
   }
   // Put tab instructions above their group so the sample remains readable.
   setPlacement(step === 1 ? 'top' : window.innerWidth - rect.right >= 340 ? 'right' : rect.left >= 340 ? 'left' : rect.top >= 220 ? 'top' : 'bottom')
   setTarget(previous => previous === anchor ? previous : anchor)
  }
  inspectRef.current = schedule
  window.addEventListener('resize',revealAfterResize); window.addEventListener('scroll',schedule,true)
  window.addEventListener('keydown',key,true); document.addEventListener('visibilitychange',schedule)
  schedule()
  return stop
 }, [active, blocked, account, deepLink, notificationRevision, root, session])
 const current = running?.step ?? 0
 const valid = running !== undefined && running.account === account && running.revision === notificationRevision && active && !blocked && !deepLink
 const change = (step: number) => {
  if (!state.current) return
  const next = { ...state.current, step }
  focusRequested.current = true
  const currentPanel = document.querySelector<HTMLElement>('[data-arkme-recording-tour-panel]')
  if (currentPanel) panelHeight.current = currentPanel.getBoundingClientRect().height
  state.current = next; setRunning(next); setTarget(undefined); inspectRef.current()
 }
 const finish = (restore = true) => finishRef.current(restore)
 const panel = valid && target ? createPortal(<div data-arkme-recording-tour-viewport style={{ position: 'fixed', inset: 0, zIndex: 100100, pointerEvents: 'none' }}>
  <style>{`[data-arkme-recording-tour-highlight="true"] { outline: 2px solid var(--arkme-accent, #8674ee); outline-offset: 5px; border-radius: 10px; } [data-arkme-recording-tour-panel] { pointer-events: auto; max-width: calc(100vw - 24px); }`}</style>
  <svg data-arkme-recording-tour-mask aria-hidden="true" width="100%" height="100%" style={{ position:'absolute', inset:0, pointerEvents:'none' }}>
   <defs><mask id={maskId}><rect width="100%" height="100%" fill="white"/>{spotlights.map(rect => <rect key={rect.id} data-arkme-recording-tour-spotlight={rect.id} x={rect.left} y={rect.top} width={rect.width} height={rect.height} fill="black"/>)}</mask></defs>
   <rect width="100%" height="100%" fill="rgba(0,0,0,.5)" mask={`url(#${maskId})`}/>
   <path data-arkme-recording-tour-mask-blocker fill="transparent" fillRule="evenodd" style={{ pointerEvents:'auto' }} d={`M0 0H${window.innerWidth}V${window.innerHeight}H0Z ${spotlights.map(rect => `M${rect.left} ${rect.top}h${rect.width}v${rect.height}h${-rect.width}Z`).join(' ')}`}/>
  </svg>
  <Tour open current={0} prefixCls="arkme-home-tour" getPopupContainer={false} mask={false} disabledInteraction={false} keyboard={false} scrollIntoViewOptions={false} arrow={{ pointAtCenter: true }} placement={placement} builtinPlacements={current === 1 ? samplePlacements : placements} zIndex={100100}
   steps={[{ ...steps[current]!, target, scrollIntoViewOptions: false }]}
   renderPanel={() => <section className="arkme-home-tour-panel" data-arkme-recording-tour-panel role="region" aria-label="录音体验引导">
    <div className="arkme-home-tour-header"><span className="arkme-home-tour-progress" aria-live="polite">{current + 1} / 3</span><button type="button" className="arkme-home-tour-close" aria-label="关闭录音体验" onClick={() => finish()}>×</button></div>
    <h2>{steps[current]!.title}</h2><p>{steps[current]!.description}</p>
    <div className="arkme-home-tour-actions"><button type="button" className="arkme-home-tour-skip" onClick={() => finish()}>跳过引导</button><div className="arkme-home-tour-navigation">{current > 0 && <button type="button" onClick={() => change(current-1)}>上一步</button>}<button ref={focusTourButton} type="button" className="arkme-home-tour-primary" onClick={() => current === 2 ? finish() : change(current+1)}>{current === 2 ? '完成体验' : '下一步'}</button></div></div>
   </section>} />
 </div>, document.body) : null
 return { sample: valid && current === 1, panel, finish }
}
