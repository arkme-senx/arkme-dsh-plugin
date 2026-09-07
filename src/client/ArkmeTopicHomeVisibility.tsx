import { useEffect, useRef, useState } from 'react'
import { createArkmeSdk } from '../sdk/index.js'

/** A narrow setting on the existing topic surface; the record service owns the value. */
export function ArkmeTopicHomeVisibility({ sourceRef }: { sourceRef: string }) {
  const [value, setValue] = useState<boolean>()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(false)
  const [retry, setRetry] = useState(0)
  const scope = useRef<AbortController>()
  const submitting = useRef(false)
  useEffect(() => {
    const controller = new AbortController()
    scope.current = controller
    setBusy(true)
    setError(false)
    void createArkmeSdk().topicHomeVisibility(sourceRef, undefined, controller.signal).then(result => {
      if (!controller.signal.aborted) setValue(result.showInHome)
    }).catch(() => {
      if (!controller.signal.aborted) setError(true)
    }).finally(() => {
      if (!controller.signal.aborted) setBusy(false)
    })
    return () => { controller.abort() }
  }, [sourceRef, retry])
  return <section aria-label="DSH 输入主题设置" style={{ padding: '8px 16px', fontSize: 12 }}>
    <span>系统主题 · 仅归档你在 DSH 中手动提交的文本</span>
    <label style={{ marginLeft: 12 }}><input type="checkbox" checked={value ?? false} disabled={busy || value === undefined}
      onChange={event => {
        if (submitting.current || value === undefined) return
        const controller = scope.current
        if (controller === undefined || controller.signal.aborted) return
        const next = event.currentTarget.checked
        submitting.current = true
        setBusy(true)
        setError(false)
        void createArkmeSdk().topicHomeVisibility(sourceRef, next, controller.signal).then(result => {
          if (!controller.signal.aborted) setValue(result.showInHome)
        }).catch(() => { if (!controller.signal.aborted) setError(true) }).finally(() => {
          submitting.current = false
          if (!controller.signal.aborted) setBusy(false)
        })
      }} />在首页展示</label>
    {error && <button type="button" disabled={busy} onClick={() => { setRetry(value => value + 1) }}>设置读取或保存失败，重试</button>}
  </section>
}
