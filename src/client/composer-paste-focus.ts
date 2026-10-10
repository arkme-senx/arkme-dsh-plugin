import { useEffect, useRef, type RefObject } from 'react'
import type { ArkmeComposerFocusTarget } from './composer-focus.js'
import type { ArkmeComposerSelectionRequest } from './composer-selection-request.js'

interface PasteFocusTarget extends ArkmeComposerFocusTarget {
  readonly selectionStart: number
  readonly selectionEnd: number
}

/** Capture before disabling the editor; publish a one-shot selection after staging. */
export function useComposerPasteFocus(options: {
  scope: object
  generation?: number | undefined
  active: boolean
  editor: RefObject<PasteFocusTarget>
  container: RefObject<HTMLElement>
  onReady: (request: ArkmeComposerSelectionRequest) => void
}): (options?: { nativeDialog?: boolean; ownedDialog?: () => HTMLElement | null }) => () => void {
  const latest = useRef(options)
  latest.current = options
  const intent = useRef(0)
  const mounted = useRef(false)
  const nativeDialogIntent = useRef<number>()
  const ownedDialog = useRef<(() => HTMLElement | null)>()
  useEffect(() => {
    mounted.current = true
    const doc = options.container.current?.ownerDocument
    if (!doc) return () => { mounted.current = false }
    const isOwned = (target: EventTarget | null) => target instanceof Node && ownedDialog.current?.()?.contains(target) === true
    const cancel = (event?: Event) => { if (!event || !isOwned(event.target)) intent.current += 1 }
    const windowBlur = () => { if (nativeDialogIntent.current !== intent.current) cancel() }
    const focus = (event: FocusEvent) => {
      if (isOwned(event.target)) return
      if (!(event.target instanceof Node) || !latest.current.container.current?.contains(event.target)) cancel()
    }
    const key = (event: KeyboardEvent) => { if (event.key === 'Tab' || event.key === 'Escape') cancel(event) }
    // A click on non-focusable content is still an explicit user choice. Checking
    // document.activeElement alone would mistakenly restore focus from <body>.
    doc.addEventListener('pointerdown', cancel, true)
    doc.addEventListener('focusin', focus, true)
    doc.addEventListener('keydown', key, true)
    doc.defaultView?.addEventListener('blur', windowBlur)
    return () => {
      mounted.current = false
      cancel()
      doc.removeEventListener('pointerdown', cancel, true)
      doc.removeEventListener('focusin', focus, true)
      doc.removeEventListener('keydown', key, true)
      doc.defaultView?.removeEventListener('blur', windowBlur)
    }
  }, [options.container])

  return (captureOptions = {}) => {
    const captured = latest.current
    const target = captured.editor.current
    const container = captured.container.current
    const doc = container?.ownerDocument
    if (!target || target.disabled || !captured.active || !doc || !container.contains(doc.activeElement)) return () => {}
    const version = ++intent.current
    ownedDialog.current = captureOptions.ownedDialog
    if (captureOptions.nativeDialog === true) nativeDialogIntent.current = version
    const canApply = () => {
      const current = latest.current
      return mounted.current && current.active && current.scope === captured.scope
        && current.generation === captured.generation && intent.current === version
        && (doc.activeElement === doc.body || current.container.current?.contains(doc.activeElement) === true
          || ownedDialog.current?.()?.contains(doc.activeElement) === true)
    }
    const request: ArkmeComposerSelectionRequest = {
      text: target.value, start: target.selectionStart, end: target.selectionEnd, canApply,
    }
    return () => {
      if (nativeDialogIntent.current === version) nativeDialogIntent.current = undefined
      if (canApply()) latest.current.onReady(request)
      if (intent.current === version) ownedDialog.current = undefined
    }
  }
}
