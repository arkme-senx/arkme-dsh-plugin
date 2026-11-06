import { useEffect, useMemo, useRef, useState } from 'react'
import type { ArkmeExportSelection, ArkmeRangeExportPreview } from '../data-management.js'
import { createArkmeSdk } from '../sdk/index.js'
import { recordExportDateError, type RecordExportDates, type RecordExportRangeKind } from './record-export-selection.js'

/** Display remembered counts while Host validates the selection and directory.
 * Only the current Host response authorizes export; the Host owns plan reuse. */
export function useRecordExportRange(scope: string, supported: boolean, mode: RecordExportRangeKind, dates: RecordExportDates, includeAttachments: boolean, order: 1 | 2, destinationRef?:string) {
  const selection = useMemo<ArkmeExportSelection>(() => ({ mode, timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC', includeAttachments,
    ...(mode === 'dates' ? { startDate: dates.start, endDate: dates.end } : {}) }), [mode, dates.start, dates.end, includeAttachments])
  const [revision, setRevision] = useState(0)
  const refreshNext = useRef(false)
  const displayed = useRef(new Map<string, ArkmeRangeExportPreview>())
  const displayKey = JSON.stringify([scope, selection, order])
  const key = JSON.stringify([displayKey, destinationRef, revision])
  const [state, setState] = useState<{ key: string; preview?: ArkmeRangeExportPreview; error?: string }>({ key: '' })
  const valid = mode !== 'dates' || !recordExportDateError(dates)
  useEffect(() => { displayed.current.clear(); return () => displayed.current.clear() }, [scope])
  useEffect(() => {
    if (!supported || !valid) { displayed.current.clear(); setState({ key: '' }); return }
    const controller = new AbortController(), sdk = createArkmeSdk()
    const refresh = refreshNext.current
    refreshNext.current = false
    void sdk.previewRecordExport(scope, selection, order, controller.signal, destinationRef, { directory: true, refresh })
      .then(preview => {
        if (controller.signal.aborted) return
        displayed.current.delete(displayKey)
        while (displayed.current.size >= 12) displayed.current.delete(displayed.current.keys().next().value!)
        displayed.current.set(displayKey, preview)
        setState({ key, preview })
      })
      .catch(error => { if (!controller.signal.aborted) setState({ key, error: error instanceof Error ? error.message : '导出范围暂时无法读取，请重试' }) })
      .finally(() => sdk.dispose())
    return () => { controller.abort(); sdk.dispose() }
  }, [scope, supported, valid, key, displayKey, selection, order, destinationRef])
  return { selection, refresh: () => { displayed.current.clear(); refreshNext.current = true; setRevision(value => value + 1) },
    preview: supported && valid ? (state.key === key ? state.preview : displayed.current.get(displayKey)) : undefined,
    error: supported && state.key === key ? state.error : undefined,
    loading: supported && valid && (state.key !== key || !state.preview && !state.error) }
}
