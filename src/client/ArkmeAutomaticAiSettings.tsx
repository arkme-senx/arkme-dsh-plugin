import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { automaticCapabilityDescriptions, type ArkmeCapabilitySetting, type ArkmeCapabilitySettings } from '../capabilities.js'
import { callArkme } from './api.js'
import { ArkmeConfirmDialog } from './ArkmeConfirmDialog.js'
import { tr, useArkmeLocale } from './locale.js'

const capabilityLocations: Record<ArkmeCapabilitySetting['key'], string> = {
  personal_profile: '手机「探索 → 个人档案」',
  record_thought: '手机快记列表或详情',
  chat_thought: '手机聊天页面',
  arrangement_recognition: '左侧「安排」',
  goal_insight: '手机「探索 → 目标」',
}

export function ArkmeAutomaticAiSettings({ accountScope }: { accountScope: string }) {
  useArkmeLocale()
  const [settings, setSettings] = useState<ArkmeCapabilitySetting[]>()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [loadedScope, setLoadedScope] = useState('')
  const [retryProfile, setRetryProfile] = useState(false)
  const scopeRef = useRef(accountScope); scopeRef.current = accountScope
  const [confirm, setConfirm] = useState<ArkmeCapabilitySetting>()
  const pending = useRef(false), active = useRef(true), generation = useRef(0)
  const controller = useRef<AbortController>(), titleId = useId()
  const reload = useCallback(async (failure = '') => {
    const current = ++generation.current
    controller.current?.abort()
    const request = new AbortController(); controller.current = request
    setLoading(true); setError(failure)
    try {
      const result = await callArkme<ArkmeCapabilitySettings>('account.capabilities.query', { expectedAccountScope: accountScope }, request.signal)
      if (active.current && current === generation.current) {
        if (result.accountScope !== accountScope) throw new Error('账号已切换')
        setSettings(result.settings); setLoadedScope(accountScope)
        if (!result.settings.some(item => item.key === 'personal_profile' && item.enabled)) setRetryProfile(false)
      }
    } catch {
      if (active.current && current === generation.current) { setSettings(undefined); setError(tr('无法读取当前设置，请重试')) }
    } finally { if (active.current && current === generation.current) setLoading(false) }
  }, [accountScope])
  useEffect(() => {
    active.current = true
    pending.current = false; setSaving(false); setConfirm(undefined); setError(''); setRetryProfile(false)
    void reload()
    const focus = () => { if (!pending.current) void reload() }
    window.addEventListener('focus', focus)
    return () => { active.current = false; generation.current++; controller.current?.abort(); window.removeEventListener('focus', focus) }
  }, [reload])
  const save = async (setting: ArkmeCapabilitySetting, enabled: boolean) => {
    if (pending.current || loadedScope !== accountScope || scopeRef.current !== accountScope) return
    const ownsScope = () => active.current && scopeRef.current === accountScope
    pending.current = true; setSaving(true); setError('')
    let failure = ''
    try {
      await callArkme<ArkmeCapabilitySettings>('account.capabilities.update', { expectedAccountScope: accountScope, key: setting.key, enabled, expectedVersion: setting.version, billingConsent: enabled })
      if (ownsScope() && setting.key === 'personal_profile') setRetryProfile(false)
    } catch {
      if (ownsScope()) {
        failure = tr('操作未完成，已重新读取当前设置。请检查后重试。')
        setError(failure)
        if (setting.key === 'personal_profile' && enabled) setRetryProfile(true)
      }
    } finally {
      if (ownsScope()) { pending.current = false; setSaving(false); setConfirm(undefined); await reload(failure) }
    }
  }
  const visibleSettings = loadedScope === accountScope ? settings : undefined
  const profile = visibleSettings?.find(item => item.key === 'personal_profile' && item.enabled)
  return <section className="arkme-automatic-ai" aria-label={tr('AI 自动分析')}>
    <h3>{tr('AI 自动分析')}</h3>
    <p>{tr('开启后自动分析，消耗 AI 额度。')}</p>
    {error && <p role="alert">{error}</p>}
    {loading && <p role="status">{tr('正在读取设置…')}</p>}
    {!loading && !settings && <button type="button" onClick={() => { setError(''); void reload() }}>{tr('重新加载')}</button>}
    {visibleSettings?.map(setting => <div className="arkme-automatic-ai-row" key={setting.key}>
      <span>{tr(setting.title)}</span>
      <button className="arkme-automatic-ai-switch" type="button" role="switch" aria-label={tr(setting.title)} aria-checked={setting.enabled} disabled={loading || saving}
        onClick={() => setting.enabled ? void save(setting, false) : setConfirm(setting)}><span aria-hidden="true" /></button>
    </div>)}
    <details className="arkme-automatic-ai-help"><summary>{tr('使用说明')}</summary>
      {visibleSettings?.map(setting => <p key={setting.key}><strong>{tr(setting.title)}</strong>：{tr(capabilityLocations[setting.key])}</p>)}
    </details>
    {retryProfile && profile && !loading && <button type="button" disabled={saving} onClick={() => { void save(profile, true) }}>{tr('个人档案已授权，重试启动分析')}</button>}
    {confirm && loadedScope === accountScope && <ArkmeConfirmDialog titleId={titleId} title={tr('开启功能')} busy={saving} onClose={() => setConfirm(undefined)}
      description={<>{tr(confirm.title)}：{tr(automaticCapabilityDescriptions[confirm.key])}</>}
      confirmLabel={tr('同意并开启')} busyLabel={tr('正在开启…')} onConfirm={() => { void save(confirm, true) }} />}
  </section>
}
