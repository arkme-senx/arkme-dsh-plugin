import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { createArkmeSdk } from '../sdk/index.js'
import { arkmeTheme } from './arkme-theme.js'
import { withArkmeReadDeadline } from './read-deadline.js'

const styles: Record<string, CSSProperties> = {
  footer: { flexShrink: 0, minHeight: 72, width: '100%', boxSizing: 'border-box',
    padding: '14px 22px', borderTop: `1px solid ${arkmeTheme.border}`, background: arkmeTheme.base,
    color: arkmeTheme.secondary, fontSize: 13, lineHeight: '20px' },
  row: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px 24px', flexWrap: 'wrap' },
  title: { color: arkmeTheme.text, fontWeight: 500 },
  hint: { fontSize: 12, color: arkmeTheme.tertiary },
  setting: { display: 'inline-flex', alignItems: 'center', gap: 8, minHeight: 32, cursor: 'pointer' },
  checkbox: { width: 18, height: 18, margin: 0, accentColor: arkmeTheme.primaryAction },
  error: { display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginTop: 8, color: arkmeTheme.danger },
  retry: { border: `1px solid ${arkmeTheme.border}`, borderRadius: 6, padding: '4px 10px',
    color: arkmeTheme.text, background: arkmeTheme.base, font: 'inherit', cursor: 'pointer' },
}

/** A narrow setting on the existing topic surface; the record service owns the value. */
export function ArkmeTopicHomeVisibility({ sourceRef }: { sourceRef: string }) {
  return <TopicHomeVisibilitySetting key={sourceRef} sourceRef={sourceRef} />
}

function TopicHomeVisibilitySetting({ sourceRef }: { sourceRef: string }) {
  const [value, setValue] = useState<boolean>()
  const [busy, setBusy] = useState(true)
  const [error, setError] = useState(false)
  const [retry, setRetry] = useState(0)
  const scope = useRef<AbortController>()
  const submitting = useRef(false)
  useEffect(() => {
    const controller = new AbortController()
    scope.current = controller
    setBusy(true)
    setError(false)
    void withArkmeReadDeadline(signal => createArkmeSdk().topicHomeVisibility(sourceRef, undefined, signal), controller.signal).then(result => {
      if (!controller.signal.aborted) setValue(result.showInHome)
    }).catch(() => {
      if (!controller.signal.aborted) setError(true)
    }).finally(() => {
      if (!controller.signal.aborted) setBusy(false)
    })
    return () => { controller.abort() }
  }, [sourceRef, retry])
  return <footer aria-label="DSH 输入主题设置" style={styles.footer} aria-busy={busy}>
    <div style={styles.row}>
      <div><div style={styles.title}>系统主题 · DSH 会话输入记录</div>
        <div style={styles.hint}>不支持在此新增快记</div></div>
    {value === undefined ? (busy ? <span role="status">正在读取设置…</span> : null)
      : <label style={styles.setting}><input type="checkbox" aria-label="在首页展示" style={styles.checkbox} checked={value} disabled={busy}
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
      }} />在首页展示</label>}
    </div>
    {error && <div role="alert" style={styles.error}><span>设置读取或保存失败</span>
      <button type="button" style={styles.retry} disabled={busy} onClick={() => { setRetry(value => value + 1) }}>重新读取设置</button></div>}
  </footer>
}
