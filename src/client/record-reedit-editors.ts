import { useCallback, useRef, useState, type SetStateAction } from 'react'
import type { ArkmeRecordReeditAttachmentView, ArkmeRecordReeditEditorSnapshot } from '../record-reedit-contract.js'
import type { ArkmeTimelineItem } from '../types.js'

interface RecordReeditScope {
  accountKey: string | undefined
  sourceKey: string
  sourceRef: string
}

export interface ArkmeRecordReeditComposerState extends RecordReeditScope {
  generation: number
  item: ArkmeTimelineItem
  snapshot: ArkmeRecordReeditEditorSnapshot | undefined
  title: string
  textContent: string
  attachments: ArkmeRecordReeditAttachmentView[]
  // One session owns its CAS revision and queue, even when its editor is inactive.
  persisted: { candidateKey: string; draftRevision: number; saveTail: Promise<void>; exclusive?: boolean }
  loading: boolean
  busy: boolean
  error: string
  conflict?: 'record' | 'draft' | undefined
  recoveryConfirmation?: boolean | undefined
}

const scopeKey = (scope: RecordReeditScope) => JSON.stringify([scope.accountKey, scope.sourceKey])
const editorKey = (scope: RecordReeditScope, itemUid: string) => JSON.stringify([scopeKey(scope), itemUid])

interface Editors {
  candidates: Map<string, ArkmeRecordReeditComposerState>
  selected: Map<string, string>
  currentKey: string | undefined
}

/** In-memory input owner; Host drafts and accepted submission receipts keep their existing owners. */
export function useRecordReeditEditors() {
  const [state, setState] = useState<Editors>(() => ({ candidates: new Map(), selected: new Map(), currentKey: undefined }))
  const stateRef = useRef(state)
  const composerRef = useRef<ArkmeRecordReeditComposerState>()
  const publish = useCallback((next: Editors) => {
    stateRef.current = next
    composerRef.current = next.currentKey === undefined ? undefined : next.candidates.get(next.currentKey)
    setState(next)
  }, [])
  const updateCandidate = useCallback((target: ArkmeRecordReeditComposerState,
    update: (current: ArkmeRecordReeditComposerState) => ArkmeRecordReeditComposerState | undefined) => {
    const previous = stateRef.current
    const key = editorKey(target, target.item.itemUid)
    const current = previous.candidates.get(key)
    if (current === undefined || current.persisted !== target.persisted) return
    const value = update(current)
    if (value === current) return
    const next = { ...previous, candidates: new Map(previous.candidates), selected: new Map(previous.selected) }
    if (value === undefined) {
      next.candidates.delete(key)
      if (next.selected.get(scopeKey(target)) === key) next.selected.delete(scopeKey(target))
      if (next.currentKey === key) next.currentKey = undefined
    } else next.candidates.set(key, value)
    publish(next)
  }, [publish])
  const setComposer = useCallback((update: SetStateAction<ArkmeRecordReeditComposerState | undefined>) => {
    const current = composerRef.current
    const value = typeof update === 'function' ? update(current) : update
    if (value === current) return
    if (value === undefined) {
      if (current !== undefined) updateCandidate(current, () => undefined)
      return
    }
    const previous = stateRef.current
    const key = editorKey(value, value.item.itemUid)
    publish({ candidates: new Map(previous.candidates).set(key, value),
      selected: new Map(previous.selected).set(scopeKey(value), key), currentKey: key })
  }, [publish, updateCandidate])
  const activateScope = useCallback((scope: RecordReeditScope, generation: number) => {
    const previous = stateRef.current
    const key = previous.selected.get(scopeKey(scope))
    const current = key === undefined ? undefined : previous.candidates.get(key)
    const candidates = new Map(previous.candidates)
    if (current !== undefined && key !== undefined) candidates.set(key, { ...current, generation })
    publish({ ...previous, candidates, currentKey: key })
  }, [publish])
  const findCandidate = useCallback((scope: RecordReeditScope, itemUid: string) =>
    stateRef.current.candidates.get(editorKey(scope, itemUid)), [])
  return { composer: state.currentKey === undefined ? undefined : state.candidates.get(state.currentKey),
    composerRef, setComposer, updateCandidate, activateScope, findCandidate }
}
