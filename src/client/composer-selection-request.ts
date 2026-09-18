import { useLayoutEffect, useRef } from 'react'

/** A one-shot caret request tied to the exact externally edited draft. */
export interface ArkmeComposerSelectionRequest {
  text: string
  start: number
  end: number
}

export function useComposerSelectionRequest(
  request: ArkmeComposerSelectionRequest | undefined,
  value: string,
  disabled: boolean,
  apply: (request: ArkmeComposerSelectionRequest) => boolean,
): void {
  const consumed = useRef<ArkmeComposerSelectionRequest>()
  // Run after the editor's document-sync layout effect, including delayed editor
  // initialization. A later edit must never resurrect an old focus request.
  useLayoutEffect(() => {
    if (request === undefined || consumed.current === request) return
    consumed.current = request
    if (disabled || value !== request.text) return
    if (!apply(request)) consumed.current = undefined
  })
}
