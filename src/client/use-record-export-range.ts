import { useEffect, useMemo, useState } from 'react'
import type { ArkmeExportSelection, ArkmeRangeExportPreview } from '../data-management.js'
import { createArkmeSdk } from '../sdk/index.js'
import { recordExportDateError, type RecordExportDates, type RecordExportRangeKind } from './record-export-selection.js'

/** No full-account scan and no request on each keystroke. A response belongs to
 * one exact selection/account, even before the effect for a new selection runs. */
export function useRecordExportRange(scope: string, supported: boolean, mode: RecordExportRangeKind, dates: RecordExportDates, includeAttachments: boolean, order: 1 | 2) {
  const selection = useMemo<ArkmeExportSelection>(() => ({ mode, timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC', includeAttachments,
    ...(mode === 'dates' ? { startDate: dates.start, endDate: dates.end } : {}) }), [mode, dates.start, dates.end, includeAttachments])
  const key = JSON.stringify([scope, selection, order])
  const [state, setState] = useState<{ key: string; preview?: ArkmeRangeExportPreview; error?: string }>({ key: '' })
  const valid = mode !== 'dates' || !recordExportDateError(dates)
  useEffect(() => {
    if (!supported || !valid) { setState({ key: '' }); return }
    const controller = new AbortController()
    let sdk: ReturnType<typeof createArkmeSdk> | undefined
    const timer = setTimeout(() => {
      sdk = createArkmeSdk()
      void sdk.previewRecordExport(scope, selection, order, controller.signal)
        .then(preview => { if (!controller.signal.aborted) setState({ key, preview }) })
        .catch(error => { if (!controller.signal.aborted) setState({ key, error: error instanceof Error ? error.message : '导出范围暂时无法读取，请重试' }) })
        .finally(() => sdk?.dispose())
    }, 500)
    return () => { clearTimeout(timer); controller.abort(); sdk?.dispose() }
  }, [scope, supported, valid, key, selection, order])
  return { selection, preview: supported && state.key === key ? state.preview : undefined,
    error: supported && state.key === key ? state.error : undefined,
    loading: supported && valid && (state.key !== key || !state.preview && !state.error) }
}
