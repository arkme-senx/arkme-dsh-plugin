import { useEffect, useState } from 'react'
import type { ArkmeRecordingTranscriptVersionPage, ArkmeRecordingWindow } from '../../types.js'
import { callArkme } from '../api.js'

/** Only metadata is fetched by the main page. Bodies belong to the open dialog. */
export function useRecordingTranscriptVersions(scope: string, enabled: boolean, dateStamp: number, window?: ArkmeRecordingWindow, currentView?: string) {
  const [result, setResult] = useState<{ scope: string; value: ArkmeRecordingTranscriptVersionPage }>()
  useEffect(() => {
    if (!enabled) return
    const controller = new AbortController()
    void callArkme<ArkmeRecordingTranscriptVersionPage>('recordings.transcript.versions', {
      dateStamp, source: 'system', ...(window ? { window } : {}),
    }, controller.signal, { priority: 'background' }).then(value => {
      if (!controller.signal.aborted) setResult({ scope, value })
    }).catch(() => { /* Keep an already known entry available on a transient failure. */ })
    return () => controller.abort()
  }, [scope, enabled, dateStamp, window, currentView])
  return { list: enabled && result?.scope === scope ? result.value : undefined }
}
