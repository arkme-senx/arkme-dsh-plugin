import { useEffect, useState } from 'react'
import { callArkme } from './api.js'
import { useArkmeEffectiveTimeZone } from './display-time-zone.js'
import { tr } from './locale.js'

type Settings = { enabled: boolean }

export function ArkmeRecordingDeletionSettings({ scope }: { scope: string }) {
  const timeZone = useArkmeEffectiveTimeZone()
  const [enabled, setEnabled] = useState<boolean>()
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => {
    const controller = new AbortController()
    void callArkme<Settings>('recordings.ai-deletion.settings', { accountScope: scope }, controller.signal)
      .then(result => { if (!controller.signal.aborted) setEnabled(result.enabled) })
      .catch(() => { if (!controller.signal.aborted) setError(tr('录音删除权限读取失败')) })
    return () => controller.abort()
  }, [scope])

  async function save(next: boolean) {
    setSaving(true)
    setError('')
    try {
      const result = await callArkme<Settings>('recordings.ai-deletion.settings', { accountScope: scope, enabled: next, timeZone })
      setEnabled(result.enabled)
    } catch {
      setError(tr('录音删除权限保存失败，请重试'))
    } finally {
      setSaving(false)
    }
  }
  return <section aria-label={tr('允许 DSH 删除云端录音')}>
    <label className="arkme-settings-preference">
      <span>{tr('允许 DSH 删除云端录音')}</span>
      <input type="checkbox" role="switch" checked={enabled === true} disabled={enabled === undefined || saving}
        aria-describedby="arkme-recording-delete-permission-hint" onChange={event => { void save(event.currentTarget.checked) }} />
    </label>
    <p className="arkme-data-hint" id="arkme-recording-delete-permission-hint">{tr('仅对本机当前账号生效。每批永久删除整份录音前都由你确认。')}</p>
    {error && <p role="alert" className="arkme-data-error">{error}</p>}
  </section>
}
