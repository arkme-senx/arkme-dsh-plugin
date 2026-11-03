import { useEffect, useRef, useState } from 'react'
import type {
  ArrangementRecognitionSettings,
  ArrangementRecognitionInspection,
  ArrangementRecognitionSource,
} from '../arrangement-recognition.js'
import type { ArkmeArrangementItem } from '../types.js'
import type { ModelChoice } from '../model-directory.js'
import { callArkme } from './api.js'
import { tr } from './locale.js'
import { sourceNames } from './ArkmeArrangementRecognitionViews.js'
import { inspectArrangementTrace } from './arrangement-occurrence-ui.js'
const failure = (error: unknown) =>
  error instanceof Error ? error.message : tr('无法读取，请重试')

export function useArrangementRecognitionSettings(accountScope: string) {
  const [settings, setSettings] = useState<ArrangementRecognitionSettings>(),
    [source, setSource] = useState<ArrangementRecognitionSource>('default')
  const [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(true),
    [picker, setPicker] = useState(false)
  const [attempt, setAttempt] = useState(0),
    [notice, setNotice] = useState('')
  const alive = useRef(true),
    pending = useRef(false)
  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])
  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    setSettings(undefined)
    setError('')
    void callArkme<ArrangementRecognitionSettings>(
      'arrangements.recognition.settings.get',
      { expectedAccountScope: accountScope },
      controller.signal,
    )
      .then((result) => {
        if (!controller.signal.aborted && result.accountScope === accountScope) setSettings(result)
      })
      .catch((error) => {
        if (!controller.signal.aborted) setError(failure(error))
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })
    return () => controller.abort()
  }, [accountScope, attempt])
  const config = settings?.sources.find((item) => item.source === source)
  const choices: ModelChoice[] =
    settings?.models.map((model) => ({
      id: 'arrangement:' + model.route_key,
      name: model.display_name,
      identifier: model.model_key,
      channel: model.provider,
      arrangement: model.route_key,
    })) ?? []
  const model = settings?.models.find((model) => model.route_key === config?.effective_route_key)
  const save = async (routeKey: string) => {
    if (pending.current) return false
    pending.current = true
    setBusy(true)
    setError('')
    setNotice('')
    try {
      const result = await callArkme<ArrangementRecognitionSettings>(
        'arrangements.recognition.settings.set',
        { expectedAccountScope: accountScope, source, routeKey },
      )
      if (!alive.current) return false
      if (result.accountScope !== accountScope) throw new Error(tr('账号已切换，请重新打开'))
      setSettings(result)
      window.dispatchEvent(new Event('arkme-arrangement-recognition-settings-changed'))
      setNotice(tr('已保存，后续识别使用新设置；历史安排不变'))
      return true
    } catch (error) {
      if (alive.current) setError(failure(error))
      return false
    } finally {
      pending.current = false
      if (alive.current) setBusy(false)
    }
  }
  return {
    settings,
    source,
    setSource,
    error,
    setError,
    busy,
    loading,
    picker,
    setPicker,
    notice,
    setNotice,
    setAttempt,
    config,
    choices,
    model,
    save,
  }
}

export function useArrangementRecognitionProcess(
  accountScope: string,
  item: ArkmeArrangementItem,
  onApplied: (item: ArkmeArrangementItem) => void,
) {
  const [open, setOpen] = useState(false),
    [result, setResult] = useState<ArrangementRecognitionInspection>(),
    [preview, setPreview] = useState<ArrangementRecognitionInspection>()
  const [inspectedTrace, setInspectedTrace] = useState('')
  const [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [attempt, setAttempt] = useState(0)
  const [manualRoute, setManualRoute] = useState(''),
    [manualModel, setManualModel] = useState(''),
    active = useRef(true),
    pending = useRef(false)
  useEffect(() => {
    active.current = true
    return () => {
      active.current = false
    }
  }, [])
  useEffect(() => {
    const inspect = (event: Event) => {
      const d = (event as CustomEvent).detail
      if (
        d?.accountScope !== accountScope ||
        d?.arrangementRef !== item.arrangementRef ||
        typeof d.traceId !== 'string'
      )
        return
      setInspectedTrace(d.traceId)
      setOpen(true)
      setAttempt((n) => n + 1)
    }
    window.addEventListener('arkme-arrangement-inspect-trace', inspect)
    return () => window.removeEventListener('arkme-arrangement-inspect-trace', inspect)
  }, [accountScope, item.arrangementRef])
  useEffect(() => {
    if (!open) return
    const controller = new AbortController()
    setBusy(true)
    setManualModel('')
    setManualRoute('')
    setError('')
    void Promise.all([
      callArkme<ArrangementRecognitionInspection>(
        'arrangements.recognition.trace',
        {
          expectedAccountScope: accountScope,
          arrangementRef: item.arrangementRef,
          ...(inspectedTrace ? { traceId: inspectedTrace } : {}),
        },
        controller.signal,
      ).then((value) => {
        if (!controller.signal.aborted) setResult(value)
      }),
      callArkme<ArrangementRecognitionSettings>(
        'arrangements.recognition.settings.get',
        { expectedAccountScope: accountScope },
        controller.signal,
      ).then((value) => {
        const manual = value.sources.find((source) => source.source === 'manual')
        const model = value.models.find((model) => model.route_key === manual?.effective_route_key)
        if (!controller.signal.aborted) {
          setManualModel(model?.display_name ?? manual?.effective_route_key ?? '')
          setManualRoute(manual?.effective_route_key ?? '')
        }
      }),
    ])
      .catch((error) => {
        if (!controller.signal.aborted) setError(failure(error))
      })
      .finally(() => {
        if (!controller.signal.aborted) setBusy(false)
      })
    return () => controller.abort()
  }, [open, accountScope, item.arrangementRef, attempt, inspectedTrace])
  useEffect(() => {
    const refresh = () => {
      setAttempt((value) => value + 1)
      setPreview(undefined)
    }
    window.addEventListener('arkme-arrangement-recognition-settings-changed', refresh)
    return () =>
      window.removeEventListener('arkme-arrangement-recognition-settings-changed', refresh)
  }, [])
  const run = async (apply = false) => {
    if (pending.current) return
    pending.current = true
    setBusy(true)
    setError('')
    try {
      const value = await callArkme<ArrangementRecognitionInspection>(
        apply ? 'arrangements.recognition.apply' : 'arrangements.recognition.preview',
        {
          expectedAccountScope: accountScope,
          arrangementRef: item.arrangementRef,
          ...(apply ? { previewId: preview?.trace?.id } : { expectedRouteKey: manualRoute }),
        },
      )
      if (!active.current) return
      if (value.accountScope !== accountScope) throw new Error(tr('账号已切换'))
      if (value.state === 'applied' && value.item) {
        onApplied(value.item)
        setPreview(undefined)
        setAttempt((value) => value + 1)
      } else {
        setPreview(value)
        if (value.state === 'conflict') {
          const fresh = await callArkme<ArkmeArrangementItem>('arrangements.detail', {
            arrangementRef: item.arrangementRef,
          })
          if (active.current) onApplied(fresh)
        }
      }
    } catch (error) {
      if (active.current) setError(failure(error))
    } finally {
      pending.current = false
      if (active.current) setBusy(false)
    }
  }
  const next = preview?.trace?.status === 'preview-ready' ? preview.trace.outcomes?.[0] : undefined
  return {
    open,
    setOpen,
    result,
    preview,
    setPreview,
    inspectedTrace,
    setInspectedTrace,
    error,
    busy,
    setAttempt,
    manualRoute,
    manualModel,
    run,
    next,
  }
}
