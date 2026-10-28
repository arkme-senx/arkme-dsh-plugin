import type { DictationTarget } from './dictation-target.js'
import { useEffect, useRef, useState } from 'react'
import type { SnapshotSelectorHook } from '@deepseek-ai/dsh-client-ui-slots'
import type { ArkmeAuthSnapshot } from '../types.js'
import type { NativeTextInputActions } from './harness-text-selection.js'
import { ArkmeDictationButton } from './ArkmeDictationButton.js'
import { callArkme } from './api.js'

export function HarnessDictationInput({ sessionId, inputActions, useInput }: {
  sessionId: string; inputActions?: NativeTextInputActions | undefined
  useInput?: SnapshotSelectorHook<{ phase: string }> | undefined
}) {
  if (!inputActions || !useInput) return null
  return <ConnectedInput key={sessionId} sessionId={sessionId} inputActions={inputActions} useInput={useInput} />
}
function ConnectedInput({ sessionId, inputActions, useInput }: { sessionId: string; inputActions: NativeTextInputActions; useInput: SnapshotSelectorHook<{ phase: string }> }) {
  const phase = useInput(value => value.phase)
  const [auth, setAuth] = useState<ArkmeAuthSnapshot>()
  const [active, setActive] = useState(true)
  const latest = useRef(inputActions); latest.current = inputActions
  useEffect(() => {
    const controller = new AbortController()
    void callArkme<ArkmeAuthSnapshot>('auth.status', {}, controller.signal).then(setAuth).catch(() => undefined)
    return () => controller.abort()
  }, [])
  useEffect(() => {
    const surface = window.frameElement?.closest<HTMLElement>('[data-arkme-owned="deepseek-harness-surface"]')
    const update = () => setActive(!document.hidden && (!surface || surface.dataset.arkmeVisible === 'true' && !surface.hasAttribute('data-arkme-history-session')))
    const observer = surface ? new MutationObserver(update) : undefined
    if (surface) observer?.observe(surface, { attributes: true, attributeFilter: ['data-arkme-visible', 'data-arkme-history-session'] })
    document.addEventListener('visibilitychange', update); update()
    return () => { observer?.disconnect(); document.removeEventListener('visibilitychange', update) }
  }, [])
  return <ArkmeDictationButton authSnapshot={auth} scopeKey={`dsh:${sessionId}`} active={active} disabled={phase !== 'plain'} getTarget={() => {
    const actions = latest.current
    return nativeDictationTarget(actions, () => actions === latest.current)
  }} />
}

export function nativeDictationTarget(actions: NativeTextInputActions, isCurrent: () => boolean): DictationTarget {
  let span = actions.captureInsertion(), closed = false, last = ''
  const from = span.end
  const replace = (text: string) => {
    if (closed || !isCurrent()) return false
    // Public native insertion rejects stale draft revisions; never overwrite a manual edit.
    if (!actions.insertText(text, { start: from, end: from + last.length, draftRev: span.draftRev })) return false
    actions.persistDraft(); span = actions.captureInsertion(); last = text; return true
  }
  return { insert: text => replace(last + text), replace, close() { closed = true } }
}
