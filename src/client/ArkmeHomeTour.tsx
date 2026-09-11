import { createHomeTourTrace, homeTourDiagnostic } from './home-tour-diagnostics.js'
import { useTourAccount } from './use-tour-account.js'
import TourModule, { type TourProps } from '@rc-component/tour'
import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import type { ArkmeAuthSnapshot } from '../types.js'
import { arkmeHomeTourSession, type ArkmeHomeTourSession } from './home-tour-session.js'

// NodeNext sees the package's CommonJS wrapper; browser bundlers unwrap its default export.
const Tour = TourModule.default ?? TourModule

const directorySteps = [
  { id: 'harness', title: 'DeepSeek Harness', description: '使用原生 AI 工作台，与模型对话、处理任务和编写代码。' },
  { id: 'arko', title: 'Arko', description: '你的个人 AI 助手，可以结合记录回答问题，帮你整理信息。' },
  { id: 'send-to-self', title: '发给自己', description: '随手保存文字、图片和文件，把想法与重要内容留给自己。' },
  { id: 'official-author', title: '联系作者', description: '遇到问题或有使用建议，可以在这里直接联系作者。' },
] as const

const navigationSteps = [
  { id: 'contacts', title: '联系人', description: '在这里查找和管理联系人，快速进入对话。' },
  { id: 'calls', title: '通话', description: '查看通话记录，回顾你的沟通内容。' },
  { id: 'recordings', title: '录音', description: '查看和回听录音，阅读转写内容，找回重要信息。' },
  { id: 'calendar', title: '日历', description: '按日期浏览记录，快速回顾某一天的内容。' },
  { id: 'world', title: '世界', description: '看看大家正在记录什么，也分享自己的想法与生活。' },
  { id: 'extensions', title: '市集', description: '发现、安装和管理插件，扩展 Arkme 的功能。' },
] as const

const allSteps = [...directorySteps, ...navigationSteps] as const
type HomeTourStep = (typeof allSteps)[number]
type HomeTourStepId = HomeTourStep['id']
const mandatoryDirectoryIds = ['harness', 'arko', 'send-to-self'] as const satisfies readonly HomeTourStepId[]
const navigationIds = navigationSteps.map(step => step.id)
const stepById = new Map<HomeTourStepId, HomeTourStep>(allSteps.map(step => [step.id, step]))

const overlaySelector = '[data-arkme-call-tour-running], [data-arkme-self-tour-running], [data-arkme-recording-tour-panel], [data-arkme-recording-tour-running], [role="dialog"], [role="alertdialog"], [role="menu"], dialog[open], [data-arkme-notification-blocking-overlay="true"], [data-arkme-web-login-dialog="true"]'
const overflow = { adjustX: true, adjustY: true, shiftX: 12, shiftY: 12 }
const placements: TourProps['builtinPlacements'] = {
  right: { points: ['cl', 'cr'], offset: [14, 0], overflow, autoArrow: true },
  left: { points: ['cr', 'cl'], offset: [-14, 0], overflow, autoArrow: true },
  bottom: { points: ['tc', 'bc'], offset: [0, 14], overflow, autoArrow: true },
  top: { points: ['bc', 'tc'], offset: [0, -14], overflow, autoArrow: true },
}

function visible(element: HTMLElement): boolean {
  if (!element.isConnected || element.closest('[hidden], [inert], [aria-hidden="true"]')) return false
  const rect = element.getBoundingClientRect()
  if (rect.width <= 0 || rect.height <= 0) return false
  for (let parent: HTMLElement | null = element; parent !== null; parent = parent.parentElement) {
    const style = window.getComputedStyle(parent)
    if (style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse') return false
  }
  return true
}

function visibleSameOriginDocuments(observeReadiness = false): Document[] {
  const documents = [document]
  for (const iframe of document.querySelectorAll<HTMLIFrameElement>('iframe')) {
    if (!visible(iframe) && !(observeReadiness && iframe.closest('[data-arkme-owned="deepseek-harness-surface"]'))) continue
    try {
      if (iframe.contentDocument?.body !== null && iframe.contentDocument?.body !== undefined) documents.push(iframe.contentDocument)
    } catch {
      // Cross-origin frames are opaque by design; only the same-origin Harness frame participates.
    }
  }
  return documents
}

function harnessOnboardingReady(): boolean {
  const frames = [...document.querySelectorAll<HTMLIFrameElement>('[data-arkme-owned="deepseek-harness-surface"] iframe')]
  return frames.length > 0 && frames.every(frame => {
    try { return frame.contentDocument?.body?.dataset.arkmeHarnessOnboarding === 'ready' }
    catch { return false }
  })
}

// The Harness first-run notice is initialization UI, unlike user-opened settings/menu dialogs.
function isHarnessFirstRunStatement(element: HTMLElement): boolean {
  if (element.ownerDocument === document || !element.matches('[role="dialog"], dialog[open]')) return false
  // Harness Modal renders a div[role=dialog][aria-label], not a native dialog.
  const title = (element.getAttribute('aria-label')
    ?? element.querySelector('h1, h2, h3, [role="heading"]')?.textContent
    ?? element.textContent ?? '').trim()
  return title === '内测声明' || title === 'Internal Testing Notice'
}

function hasOtherOverlay(documents = visibleSameOriginDocuments()): boolean {
  return documents.some(ownerDocument => [...ownerDocument.querySelectorAll<HTMLElement>(overlaySelector)].some(element =>
    !element.closest('[data-arkme-home-tour-panel]') && (element.matches('dialog[open]') ? visiblyPresentedNativeDialog(element) : visible(element))))
}

function visiblyPresentedNativeDialog(element: HTMLElement): boolean {
  if (!element.isConnected || element.closest('[hidden], [inert], [aria-hidden="true"]')) return false
  for (let parent: HTMLElement | null = element; parent !== null; parent = parent.parentElement) {
    const style = window.getComputedStyle(parent)
    if (style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse') return false
  }
  return true
}

interface HomeTourContext {
  directory: HTMLElement
  navigation: HTMLElement
}

function homeTourContext(accountKey: string): HomeTourContext | undefined {
  for (const directory of document.querySelectorAll<HTMLElement>('[data-arkme-home-tour-directory="root"]')) {
    if (directory.dataset.arkmeHomeTourAccount !== accountKey
      || directory.dataset.arkmeHomeTourReady !== 'true'
      || !visible(directory)) continue
    const shell = directory.closest<HTMLElement>('[data-arkme-owned="persistent-sidebar"]')
    const navigationCandidates = shell === null
      ? document.querySelectorAll<HTMLElement>('[data-arkme-owned="product-navigation"]')
      : shell.querySelectorAll<HTMLElement>('[data-arkme-owned="product-navigation"]')
    const navigation = [...navigationCandidates].find(visible)
    if (navigation !== undefined) return { directory, navigation }
  }
  return undefined
}

function homeTourContextDiagnostic(accountKey: string) {
  return [...document.querySelectorAll<HTMLElement>('[data-arkme-home-tour-directory="root"]')].map(directory => ({
    accountMatches: directory.dataset.arkmeHomeTourAccount === accountKey,
    ready: directory.dataset.arkmeHomeTourReady,
    visible: visible(directory),
    blockedAncestor: directory.closest('[hidden], [inert], [aria-hidden="true"]') !== null,
    visibleNavigationCount: [...(directory.closest('[data-arkme-owned="persistent-sidebar"]') ?? document)
      .querySelectorAll<HTMLElement>('[data-arkme-owned="product-navigation"]')].filter(visible).length,
  }))
}

function targetWithin(owner: HTMLElement, id: HomeTourStepId): HTMLElement | undefined {
  const target = owner.querySelector<HTMLElement>(`[data-arkme-home-tour-target="${id}"]`)
  return target !== null && visible(target) ? target : undefined
}

function resolveTargets(context: HomeTourContext, stepIds: readonly HomeTourStepId[]): HTMLElement[] | undefined {
  const targets = stepIds.map(id => targetWithin(
    navigationIds.includes(id as (typeof navigationIds)[number]) ? context.navigation : context.directory,
    id,
  ))
  return targets.every((target): target is HTMLElement => target !== undefined) ? targets : undefined
}

function mandatoryTargetsReady(context: HomeTourContext): boolean {
  return mandatoryDirectoryIds.every(id => targetWithin(context.directory, id) !== undefined)
    && navigationIds.every(id => targetWithin(context.navigation, id) !== undefined)
}

function scrollTargetWithinOwner(target: HTMLElement): void {
  const container = target.closest<HTMLElement>('[data-arkme-home-tour-scroll-container]')
  if (container === null) return
  const targetRect = target.getBoundingClientRect()
  const containerRect = container.getBoundingClientRect()
  const padding = 8
  if (targetRect.top < containerRect.top + padding) {
    container.scrollTop += targetRect.top - containerRect.top - padding
  } else if (targetRect.bottom > containerRect.bottom - padding) {
    container.scrollTop += targetRect.bottom - containerRect.bottom + padding
  }
}

type HomeTourPlacement = 'right' | 'left' | 'bottom' | 'top'

function preferredPlacement(target: HTMLElement): HomeTourPlacement {
  const targetRect = target.getBoundingClientRect()
  const horizontalSpaceNeeded = 348
  if (window.innerWidth - targetRect.right >= horizontalSpaceNeeded) return 'right'
  if (targetRect.left >= horizontalSpaceNeeded) return 'left'
  return window.innerHeight - targetRect.bottom >= 260 ? 'bottom' : 'top'
}

function HomeTourPanel({ steps, current, onPrevious, onNext, onDismiss, returnFocusTo, restoreFocus }: {
  steps: readonly HomeTourStep[]
  current: number
  onPrevious(): void
  onNext(): void
  onDismiss(): void
  returnFocusTo: HTMLElement | null
  restoreFocus: RefObject<boolean>
}) {
  const panelRef = useRef<HTMLElement>(null)
  const primaryRef = useRef<HTMLButtonElement>(null)
  const dismissAction = useRef(onDismiss)
  dismissAction.current = onDismiss
  const step = steps[current]!

  useLayoutEffect(() => {
    primaryRef.current?.focus({ preventScroll: true })
    const keepFocus = (event: FocusEvent) => {
      if (event.target instanceof Node && !panelRef.current?.contains(event.target) && !hasOtherOverlay()) {
        primaryRef.current?.focus({ preventScroll: true })
      }
    }
    const handleKey = (event: KeyboardEvent) => {
      if (hasOtherOverlay()) return
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopImmediatePropagation()
        dismissAction.current()
        return
      }
      if (event.key !== 'Tab') return
      const buttons = panelRef.current?.querySelectorAll<HTMLButtonElement>('button')
      const first = buttons?.[0]
      const last = buttons?.[buttons.length - 1]
      const outside = !panelRef.current?.contains(document.activeElement)
      if (event.shiftKey && (document.activeElement === first || outside)) { event.preventDefault(); last?.focus() }
      else if (!event.shiftKey && (document.activeElement === last || outside)) { event.preventDefault(); first?.focus() }
    }
    const keepMaskFocus = (event: PointerEvent) => {
      if (event.target instanceof Element && event.target.closest('.arkme-home-tour-mask')) event.preventDefault()
    }
    document.addEventListener('focusin', keepFocus)
    document.addEventListener('pointerdown', keepMaskFocus, true)
    window.addEventListener('keydown', handleKey, true)
    return () => {
      document.removeEventListener('focusin', keepFocus)
      document.removeEventListener('pointerdown', keepMaskFocus, true)
      window.removeEventListener('keydown', handleKey, true)
      if (restoreFocus.current && returnFocusTo !== null && visible(returnFocusTo) && !hasOtherOverlay()) returnFocusTo.focus({ preventScroll: true })
    }
  }, [returnFocusTo, restoreFocus])

  useLayoutEffect(() => {
    if (!panelRef.current?.contains(document.activeElement)) primaryRef.current?.focus({ preventScroll: true })
  }, [current])

  return <section ref={panelRef} className="arkme-home-tour-panel" data-arkme-home-tour-panel
    data-arkme-notification-blocking-overlay="true" role="dialog" aria-modal="true"
    aria-labelledby="arkme-home-tour-title" aria-describedby="arkme-home-tour-description">
    <div className="arkme-home-tour-header">
      <span className="arkme-home-tour-progress" aria-live="polite">{current + 1} / {steps.length}</span>
      <button type="button" className="arkme-home-tour-close" aria-label="关闭功能引导" onClick={onDismiss}>×</button>
    </div>
    <h2 id="arkme-home-tour-title">{step.title}</h2>
    <p id="arkme-home-tour-description">{step.description}</p>
    <div className="arkme-home-tour-actions">
      <button type="button" className="arkme-home-tour-skip" onClick={onDismiss}>跳过引导</button>
      <div className="arkme-home-tour-navigation">
        {current > 0 && <button type="button" onClick={onPrevious}>上一步</button>}
        <button ref={primaryRef} type="button" className="arkme-home-tour-primary" onClick={onNext}>{current === steps.length - 1 ? '开始使用' : '下一步'}</button>
      </div>
    </div>
  </section>
}

export interface ArkmeHomeTourProps {
  auth: ArkmeAuthSnapshot | undefined
  blocked: boolean
  routeActive: boolean
  notificationRevision: number
  session?: ArkmeHomeTourSession
}

interface ActiveHomeTour {
  accountKey: string
  stepIds: HomeTourStepId[]
  targets: HTMLElement[]
  returnFocusTo: HTMLElement | null
}

interface HomeTourMeasurement {
  id: HomeTourStepId
  target: HTMLElement
  left: number
  top: number
  width: number
  height: number
}

function targetMeasurement(id: HomeTourStepId, target: HTMLElement): HomeTourMeasurement {
  const { left, top, width, height } = target.getBoundingClientRect()
  return { id, target, left, top, width, height }
}

interface HomeTourStabilitySample {
  elements: HTMLElement[]
  geometry: HomeTourMeasurement[]
}

function stabilitySample(context: HomeTourContext, stepIds: readonly HomeTourStepId[], targets: HTMLElement[]): HomeTourStabilitySample {
  const elements = [context.directory, context.navigation, ...targets]
  return {
    elements,
    geometry: elements.map((element, index) => targetMeasurement(stepIds[index - 2] ?? 'harness', element)),
  }
}

function sameStabilitySample(previous: HomeTourStabilitySample | undefined, next: HomeTourStabilitySample): boolean {
  return previous !== undefined
    && previous.elements.length === next.elements.length
    && previous.elements.every((element, index) => element === next.elements[index])
    && previous.geometry.every((measurement, index) => {
      const candidate = next.geometry[index]!
      return measurement.left === candidate.left && measurement.top === candidate.top
        && measurement.width === candidate.width && measurement.height === candidate.height
    })
}

/** One owner in the persistent runtime, independent of the currently selected module. */
export function ArkmeHomeTour({ auth, blocked, routeActive, notificationRevision, session = arkmeHomeTourSession }: ArkmeHomeTourProps) {
  const accountKey = useTourAccount(auth)
  const [active, setActive] = useState<ActiveHomeTour>()
  const [currentStepId, setCurrentStepId] = useState<HomeTourStepId>('harness')
  const [placement, setPlacement] = useState<HomeTourPlacement>('right')
  const currentStepIdRef = useRef<HomeTourStepId>(currentStepId)
  const measurementRef = useRef<HomeTourMeasurement>()
  const dismissRef = useRef<(reason?: string) => void>(() => {})
  const restoreFocus = useRef(false)
  currentStepIdRef.current = currentStepId
  const latestInputs = useRef({ accountKey, blocked, routeActive, notificationRevision })
  latestInputs.current = { accountKey, blocked, routeActive, notificationRevision }
  useEffect(() => {
    homeTourDiagnostic('panel-committed', { accountKey, visible: active !== undefined && active.accountKey === accountKey && !blocked && routeActive, step: currentStepId })
  }, [active, accountKey, blocked, routeActive, currentStepId])

  useEffect(() => {
    const trace = createHomeTourTrace()
    trace('effect-start', { accountKey, blocked, routeActive, notificationRevision })
    setActive(undefined)
    if (accountKey === undefined || blocked || !routeActive || typeof document === 'undefined') return
    let frame = 0
    let stopped = false
    let startedStepIds: HomeTourStepId[] | undefined
    let initialStability: HomeTourStabilitySample | undefined
    let paused = false
    let pauseOwnedFocus = false
    const statementDocuments = new Set<Document>()
    let returnFocusTo: HTMLElement | null = null
    let dispatchingMeasurement = false
    measurementRef.current = undefined
    const observers = new Map<Document, MutationObserver>()
    const iframeLoadListeners = new Map<HTMLIFrameElement, () => void>()

    const stop = (reason = 'effect-cleanup') => {
      if (!stopped) trace('stop', { reason, accountKey, started: startedStepIds !== undefined, paused, step: currentStepIdRef.current, nextInputs: latestInputs.current })
      stopped = true
      if (startedStepIds !== undefined) document.body.removeAttribute('data-arkme-home-tour-running')
      cancelAnimationFrame(frame)
      observers.forEach(observer => { observer.disconnect() })
      observers.clear()
      iframeLoadListeners.forEach((listener, iframe) => { iframe.removeEventListener('load', listener) })
      iframeLoadListeners.clear()
      window.removeEventListener('resize', schedule)
      window.removeEventListener('scroll', handleScroll, true)
      document.removeEventListener('visibilitychange', schedule)
    }
    const withdraw = (reason: string) => {
      trace('withdraw', { reason, accountKey, step: currentStepIdRef.current })
      restoreFocus.current = false
      setActive(undefined)
      stop(reason)
    }
    const pause = () => {
      if (!paused) {
        const focused = document.activeElement
        pauseOwnedFocus = focused === document.body
          || (focused instanceof Element && focused.closest('[data-arkme-home-tour-panel]') !== null)
      }
      paused = true
      restoreFocus.current = false
      measurementRef.current = undefined
      setActive(undefined)
    }
    const syncDocumentObservers = () => {
      const documents = new Set(visibleSameOriginDocuments(true))
      observers.forEach((observer, ownerDocument) => {
        if (!documents.has(ownerDocument)) { observer.disconnect(); observers.delete(ownerDocument) }
      })
      documents.forEach(ownerDocument => {
        if (observers.has(ownerDocument) || ownerDocument.body === null) return
        const observer = new MutationObserver(schedule)
        observer.observe(ownerDocument.body, { childList: true, subtree: true, attributes: true,
          attributeFilter: ['class', 'style', 'hidden', 'aria-hidden', 'inert', 'role', 'open', 'data-arkme-home-tour-ready', 'data-arkme-home-tour-account', 'data-arkme-home-tour-target', 'data-arkme-recording-tour-running', 'data-arkme-self-tour-running', 'data-arkme-call-tour-running', 'data-arkme-harness-onboarding'] })
        observers.set(ownerDocument, observer)
      })
      const iframes = new Set(document.querySelectorAll<HTMLIFrameElement>('iframe'))
      iframeLoadListeners.forEach((listener, iframe) => {
        if (!iframes.has(iframe)) { iframe.removeEventListener('load', listener); iframeLoadListeners.delete(iframe) }
      })
      iframes.forEach(iframe => {
        if (iframeLoadListeners.has(iframe)) return
        const listener = () => { syncDocumentObservers(); schedule() }
        iframe.addEventListener('load', listener)
        iframeLoadListeners.set(iframe, listener)
      })
    }
    const measure = (id: HomeTourStepId, target: HTMLElement) => {
      const next = targetMeasurement(id, target)
      const previous = measurementRef.current
      measurementRef.current = next
      if (previous === undefined || previous.id !== id || previous.target !== target
        || (previous.left === next.left && previous.top === next.top && previous.width === next.width && previous.height === next.height)) return
      // rc-tour 2.4 remeasures its active target on window scroll. Emit that supported signal
      // only when our DOM observer detects the same node moved without a target identity change.
      dispatchingMeasurement = true
      window.dispatchEvent(new Event('scroll'))
      dispatchingMeasurement = false
    }
    const inspect = () => {
      frame = 0
      if (stopped) return
      syncDocumentObservers()
      const overlays = visibleSameOriginDocuments().flatMap(ownerDocument =>
        [...ownerDocument.querySelectorAll<HTMLElement>(overlaySelector)].filter(element =>
          !element.closest('[data-arkme-home-tour-panel]')
          && (element.matches('dialog[open]') ? visiblyPresentedNativeDialog(element) : visible(element))))
      const overlayDetails = overlays.map(element => ({ tag: element.tagName, role: element.getAttribute('role'), inFrame: element.ownerDocument !== document, statement: isHarnessFirstRunStatement(element), login: element.getAttribute('aria-label') === '即我登录', native: element.matches('dialog[open]') }))
      if (document.visibilityState === 'hidden' || overlays.some(element => !isHarnessFirstRunStatement(element))) {
        initialStability = undefined
        trace('blocked', { visibility: document.visibilityState, overlays: overlayDetails, started: startedStepIds !== undefined })
        if (startedStepIds !== undefined) withdraw(document.visibilityState === 'hidden' ? 'document-hidden' : 'other-overlay')
        return
      }
      if (overlays.length > 0) {
        trace('wait-statement', { accountKey, started: startedStepIds !== undefined, step: currentStepIdRef.current, overlays: overlayDetails })
        initialStability = undefined
        if (startedStepIds !== undefined) {
          overlays.forEach(element => statementDocuments.add(element.ownerDocument))
          pause()
          // showModal moves focus into the iframe before the parent MutationObserver runs.
          pauseOwnedFocus = true
        }
        return
      }
      if (!harnessOnboardingReady()) {
        trace('wait-harness-initialization', { accountKey, started: startedStepIds !== undefined })
        initialStability = undefined
        if (startedStepIds !== undefined) pause()
        return
      }
      const context = homeTourContext(accountKey)
      if (context === undefined || !mandatoryTargetsReady(context)) {
        trace('wait-targets', { accountKey, context: context !== undefined, directories: homeTourContextDiagnostic(accountKey), started: startedStepIds !== undefined, missing: context === undefined ? [] : [...mandatoryDirectoryIds, ...navigationIds].filter(id => targetWithin(navigationIds.includes(id as typeof navigationIds[number]) ? context.navigation : context.directory, id) === undefined) })
        initialStability = undefined
        if (startedStepIds !== undefined) pause()
        return
      }
      if (startedStepIds === undefined) {
        const hasAuthor = targetWithin(context.directory, 'official-author') !== undefined
        const nextStepIds = allSteps.filter(step => step.id !== 'official-author' || hasAuthor).map(step => step.id)
        const targets = resolveTargets(context, nextStepIds)
        if (targets === undefined) { initialStability = undefined; return }
        const nextStability = stabilitySample(context, nextStepIds, targets)
        if (!sameStabilitySample(initialStability, nextStability)) {
          initialStability = nextStability
          schedule()
          return
        }
        if (!session.tryStart(accountKey)) { stop('session-denied'); return }
        trace('started', { accountKey, steps: nextStepIds, visibility: document.visibilityState })
        startedStepIds = nextStepIds
        returnFocusTo = document.activeElement instanceof HTMLElement ? document.activeElement : null
        document.body.setAttribute('data-arkme-home-tour-running', 'true')
        scrollTargetWithinOwner(targets[0]!)
        setPlacement(preferredPlacement(targets[0]!))
        measure('harness', targets[0]!)
        restoreFocus.current = false
        setCurrentStepId('harness')
        setActive({ accountKey, stepIds: nextStepIds, targets, returnFocusTo })
        return
      }

      if (startedStepIds.includes('official-author') && targetWithin(context.directory, 'official-author') === undefined) {
        startedStepIds = startedStepIds.filter(id => id !== 'official-author')
        if (currentStepIdRef.current === 'official-author') {
          currentStepIdRef.current = 'contacts'
          setCurrentStepId('contacts')
        }
      }
      const targets = resolveTargets(context, startedStepIds)
      if (targets === undefined) { trace('pause-targets-unresolved', { accountKey }); pause(); return }
      if (paused) {
        const focused = document.activeElement
        const focusRemainedIdle = focused === document.body
          || (focused instanceof HTMLIFrameElement && focused.contentDocument !== null && statementDocuments.has(focused.contentDocument))
          || (focused instanceof Element && focused.closest('[data-arkme-home-tour-panel]') !== null)
        trace('resume-check', { accountKey, pauseOwnedFocus, focusRemainedIdle, focusedTag: focused?.tagName, focusInTour: focused instanceof Element && !!focused.closest('[data-arkme-home-tour-panel]'), statementDocumentCount: statementDocuments.size })
        if (!pauseOwnedFocus || !focusRemainedIdle) { withdraw('focus-moved-during-pause'); return }
        trace('resumed', { accountKey, step: currentStepIdRef.current })
      }
      const currentTargetIndex = Math.max(0, startedStepIds.indexOf(currentStepIdRef.current))
      scrollTargetWithinOwner(targets[currentTargetIndex]!)
      setPlacement(preferredPlacement(targets[currentTargetIndex]!))
      measure(startedStepIds[currentTargetIndex]!, targets[currentTargetIndex]!)
      setActive(previous => {
        if (previous === undefined) return {
          accountKey,
          stepIds: [...startedStepIds!],
          targets,
          returnFocusTo,
        }
        const unchanged = previous.stepIds.length === startedStepIds!.length
          && previous.stepIds.every((id, index) => id === startedStepIds![index])
          && previous.targets.every((target, index) => target === targets[index])
        return unchanged ? previous : { ...previous, stepIds: [...startedStepIds!], targets }
      })
      paused = false
      statementDocuments.clear()
    }
    function schedule() {
      if (!stopped && frame === 0) frame = requestAnimationFrame(inspect)
    }
    function handleScroll() {
      if (!dispatchingMeasurement) schedule()
    }

    syncDocumentObservers()
    window.addEventListener('resize', schedule)
    window.addEventListener('scroll', handleScroll, true)
    document.addEventListener('visibilitychange', schedule)
    dismissRef.current = (reason = 'panel-action') => {
      trace('dismiss', { accountKey, reason, step: currentStepIdRef.current })
      session.finish(accountKey)
      restoreFocus.current = true
      setActive(undefined)
      stop('dismissed')
    }
    schedule()
    return () => stop()
  }, [accountKey, blocked, notificationRevision, routeActive, session])

  if (active === undefined || active.accountKey !== accountKey || blocked || !routeActive) return null
  const activeSteps = active.stepIds.map(id => stepById.get(id)!)
  const current = Math.max(0, active.stepIds.indexOf(currentStepId))
  const dismiss = (reason = 'panel-action') => { dismissRef.current(reason) }
  const changeStep = (index: number) => {
    const next = Math.max(0, Math.min(active.stepIds.length - 1, index))
    const nextId = active.stepIds[next]!
    homeTourDiagnostic('step-change', { accountKey, from: currentStepIdRef.current, to: nextId })
    scrollTargetWithinOwner(active.targets[next]!)
    setPlacement(preferredPlacement(active.targets[next]!))
    measurementRef.current = targetMeasurement(nextId, active.targets[next]!)
    currentStepIdRef.current = nextId
    setCurrentStepId(nextId)
  }
  return createPortal(<div data-arkme-home-tour-viewport style={{ position: 'fixed', inset: 0, zIndex: 100_100, pointerEvents: 'none' }}>
  <Tour open current={current} onChange={changeStep} onClose={() => dismiss('tour-onClose')} onFinish={() => dismiss('tour-onFinish')}
    prefixCls="arkme-home-tour" getPopupContainer={false} zIndex={100_100}
    disabledInteraction keyboard={false} arrow={{ pointAtCenter: true }} scrollIntoViewOptions={false}
    gap={{ offset: 6, radius: 14 }} mask={{ color: 'rgba(15, 18, 26, .46)' }}
    builtinPlacements={placements} placement={placement}
    steps={activeSteps.map((step, index) => ({ ...step, target: active.targets[index]!, scrollIntoViewOptions: false }))}
    renderPanel={() => <HomeTourPanel steps={activeSteps} current={current} onDismiss={() => dismiss('panel-action')} returnFocusTo={active.returnFocusTo} restoreFocus={restoreFocus}
      onPrevious={() => { changeStep(current - 1) }}
      onNext={() => { if (current === activeSteps.length - 1) dismiss(); else changeStep(current + 1) }} />}
  />
  </div>, document.body)
}
