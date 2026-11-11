import { useLayoutEffect, useRef } from 'react'

interface ArkmeComposerSelectionRange {
  text: string
  start: number
  end: number
  /** Async attachment work must not override a later navigation/focus choice. */
  canApply?: () => boolean
}

/** One-shot selection of an exact draft range or the end of the mounted draft. */
export type ArkmeComposerSelectionRequest = ArkmeComposerSelectionRange | { atEnd: true }

export function useComposerSelectionRequest(
  request: ArkmeComposerSelectionRequest | undefined,
  value: string,
  disabled: boolean,
  apply: (request: ArkmeComposerSelectionRange) => boolean,
): void {
  const consumed = useRef<ArkmeComposerSelectionRequest>()
  // Run after the editor's document-sync layout effect, including delayed editor
  // initialization. A later edit must never resurrect an old focus request.
  useLayoutEffect(() => {
    if (request === undefined || consumed.current === request) return
    consumed.current = request
    if (disabled) return
    const range = 'atEnd' in request ? { text: value, start: value.length, end: value.length } : request
    if (value !== range.text || range.canApply?.() === false) return
    if (!apply(range)) consumed.current = undefined
  })
}
