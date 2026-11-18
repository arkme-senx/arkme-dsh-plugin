import { useEffect, useRef, useState } from 'react'
import type { ArkmeRecordingTranscriptPage, ArkmeRecordingTranscriptVersionPage, ArkmeRecordingWindow } from '../../types.js'
import { callArkme } from '../api.js'
import { useRecordingTranscriptPages } from './useRecordingTranscriptPages.js'

export function useRecordingTranscriptVersions(
  scope: string, enabled: boolean, dateStamp: number, window?: ArkmeRecordingWindow, currentView?: string,
) {
  const [selection, setSelection] = useState({ scope, versionRef: '' })
  const versionRef = enabled && selection.scope === scope ? selection.versionRef : ''
  const [list, setList] = useState<{ scope: string; value?: ArkmeRecordingTranscriptVersionPage; error?: string }>()
  const [listRequest, setListRequest] = useState({ scope, cursor: '' })
  const listCursor = listRequest.scope === scope ? listRequest.cursor : ''
  const [listRetry, setListRetry] = useState(0)
  const [initial, setInitial] = useState<{ key: string; page?: ArkmeRecordingTranscriptPage; error?: string }>()
  const [bodyRetry, setBodyRetry] = useState(0)
  const scopeRef = useRef(scope)
  scopeRef.current = scope
  const key = JSON.stringify([scope, versionRef])
  const page = initial?.key === key ? initial.page : undefined

  useEffect(() => {
    if (!enabled) return
    const controller = new AbortController()
    void callArkme<ArkmeRecordingTranscriptVersionPage>('recordings.transcript.versions', {
      dateStamp, source: 'system', ...(window ? { window } : {}), ...(listCursor ? { cursor: listCursor } : {}),
    }, controller.signal, { priority: 'background' }).then(value => {
      if (controller.signal.aborted || scopeRef.current !== scope) return
      setList(previous => ({
        scope, value: !listCursor || previous?.scope !== scope || !previous.value ? value
          : { ...value, versions: [...previous.value.versions, ...value.versions] },
      }))
    }).catch(error => {
      if (controller.signal.aborted || scopeRef.current !== scope) return
      setList(previous => ({
        scope, ...(previous?.scope === scope && previous.value ? { value: previous.value } : {}),
        error: error instanceof Error ? error.message : '读取转写历史版本失败',
      }))
    })
    return () => controller.abort()
  }, [scope, enabled, dateStamp, window, listCursor, listRetry])

  // A newly generated current version can add a list entry for this day.
  const observedView = useRef(currentView)
  useEffect(() => {
    if (observedView.current === currentView) return
    observedView.current = currentView
    if (versionRef) return
    setListRequest({ scope, cursor: '' })
    setListRetry(value => value + 1)
  }, [scope, currentView, versionRef])

  useEffect(() => {
    if (!versionRef) return
    const controller = new AbortController()
    setInitial(undefined)
    void callArkme<ArkmeRecordingTranscriptPage>('recordings.transcript.page', {
      dateStamp, ...(window ? { window } : {}), versionRef,
    }, controller.signal).then(value => {
      if (value.versionRef !== versionRef || !value.retainedSnapshot) throw new Error('转写版本不匹配，请重试')
      if (!controller.signal.aborted && scopeRef.current === scope) setInitial({ key, page: value })
    }).catch(error => {
      if (!controller.signal.aborted && scopeRef.current === scope) {
        setInitial({ key, error: error instanceof Error ? error.message : '读取转写版本失败' })
      }
    })
    return () => controller.abort()
  }, [scope, dateStamp, window, versionRef, key, bodyRetry])

  const pages = useRecordingTranscriptPages(page, key, value => setInitial({ key, page: value }))
  const currentList = list?.scope === scope ? list : undefined
  return {
    ...pages, page, versionRef, list: currentList?.value, listError: currentList?.error,
    initialError: initial?.key === key ? initial.error : undefined,
    select: (ref: string) => { setInitial(undefined); setSelection({ scope, versionRef: ref }) },
    loadVersions: () => {
      const next = currentList?.error ? listCursor : currentList?.value?.nextCursor ?? ''
      if (next === listCursor) setListRetry(value => value + 1)
      else setListRequest({ scope, cursor: next })
    },
    retryInitial: () => setBodyRetry(value => value + 1),
  }
}
