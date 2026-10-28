import { useEffect, useRef, useState } from 'react'
import { RECORDING_STRATEGIES, recordingStrategy, type RecordingProcessingPreference } from '../../recording-strategy-contract.js'
import { callArkme } from '../api.js'
import { arkmeTheme as theme } from '../arkme-theme.js'
import { tr, useArkmeLocale } from '../locale.js'
import { readRecordingProcessingPreference } from './recording-processing-preference.js'

/** One account setting for future work; execution snapshots live with jobs. */
export function RecordingProcessingSetting({ userId, active }: { userId: number; active: boolean }) {
  useArkmeLocale()
  const [value, setValue] = useState<RecordingProcessingPreference>()
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const reading = useRef(0)
  const savingRef = useRef(false)
  const [revision, refresh] = useState(0)
  useEffect(() => {
    if (!active || userId <= 0) return
    const controller = new AbortController()
    const load = () => { if (savingRef.current) return; const version = ++reading.current; void readRecordingProcessingPreference(userId, controller.signal).then(next => {
      if (!controller.signal.aborted && version === reading.current) { setValue(next); setError('') }
    }).catch(reason => { if (!controller.signal.aborted && version === reading.current) setError(reason instanceof Error ? reason.message : '录音处理设置读取失败') }) }
    load()
    if (typeof window !== 'undefined') window.addEventListener('focus', load)
    return () => { controller.abort(); if (typeof window !== 'undefined') window.removeEventListener('focus', load) }
  }, [userId, active, revision])
  const ready = value?.userId === userId
  return <section aria-label={tr('录音处理设置')} aria-busy={saving} style={{ margin: '12px 0', padding: '12px', border: `1px solid ${theme.border}`, borderRadius: 10 }}>
    <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, fontSize: 13 }}>
      <span>{tr('处理策略')}</span>
      <select aria-label={tr('统一录音处理策略')} disabled={!ready || saving || !active} value={ready ? value.strategy : ''}
        style={{ border: `1px solid ${theme.border}`, borderRadius: 6, background: theme.base, color: theme.text, padding: '6px 8px', font: 'inherit' }}
        onChange={async event => {
          const strategy = recordingStrategy(event.target.value)
          savingRef.current = true; reading.current++; setSaving(true); setError('')
          try {
            const next = await callArkme<RecordingProcessingPreference>('recordings.strategies.preference.set', { strategy, expectedUserId: userId })
            if (next.userId !== userId) throw new Error('账号已切换，请重新打开录音设置')
            setValue(next)
          } catch (reason) { setError(reason instanceof Error ? reason.message : '设置未保存，请重试') }
          finally { savingRef.current = false; setSaving(false) }
        }}>
        {!ready && <option value="">{tr('读取设置…')}</option>}
        {RECORDING_STRATEGIES.map(item => <option key={item.id} value={item.id}>{tr(item.name)}</option>)}
      </select>
    </label>
    {error && <div role="alert" style={{ marginTop: 8, fontSize: 12, color: theme.danger }}>{error} <button type="button" onClick={() => refresh(n => n + 1)}>{tr('重试')}</button></div>}
  </section>
}
