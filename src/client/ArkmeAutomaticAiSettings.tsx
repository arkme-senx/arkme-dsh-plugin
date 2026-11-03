import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { automaticCapabilityDescriptions, type ArkmeCapabilitySetting, type ArkmeCapabilitySettings } from '../capabilities.js'
import { callArkme } from './api.js'
import { ArkmeConfirmDialog } from './ArkmeConfirmDialog.js'
import { tr, useArkmeLocale } from './locale.js'

// Dedicated pages use their real entry; contextual automation explains its effect.
const capabilityGuidance: Record<ArkmeCapabilitySetting['key'], string> = {
  personal_profile: '「探索 → 个人档案」',
  record_thought: '阅读新快记，有想法时在快记下方回应你。',
  chat_thought: '根据私聊和群聊内容，在相关消息下方提供仅你可见的想法和建议。',
  arrangement_recognition: '左侧「安排」',
  offline_context: '自动关联线下录音与相关聊天，方便回看当时的交流，仅你可见。',
  goal_insight: '「探索 → 目标」',
  recording_voice_trigger: '录音日历「更多 → 语音触发」',
}

export function ArkmeAutomaticAiSettings({ accountScope, only, title = '自动使用额度', compact = false }: { accountScope: string; only?: readonly ArkmeCapabilitySetting['key'][]; title?: string; compact?: boolean }) {
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
  const visibleSettings = loadedScope === accountScope ? settings?.filter(item => !only || only.includes(item.key)) : undefined
  const profile = visibleSettings?.find(item => item.key === 'personal_profile' && item.enabled)
  const settingLabel = (setting: ArkmeCapabilitySetting) => tr(only && setting.key === 'record_thought' ? compact ? '快记里的想法' : '快记想法' : only && setting.key === 'chat_thought' ? '聊天中的建议' : setting.title.replaceAll('阿森', 'Arko'))
  return <section className="arkme-automatic-ai" aria-label={tr(title)}>
    <h3>{tr(title)}</h3>
    <p>{tr(compact ? '开启后会自动使用 AI 额度。' : '开启后自动分析，消耗 AI 额度。')}</p>
    {error && <p role="alert">{error}</p>}
    {loading && <p role="status">{tr('正在读取设置…')}</p>}
    {!loading && !settings && <button type="button" onClick={() => { setError(''); void reload() }}>{tr('重新加载')}</button>}
    {visibleSettings?.map(setting => <div className="arkme-automatic-ai-row" key={setting.key}>
      <span><span>{settingLabel(setting)}</span><small id={`${titleId}-${setting.key}-guidance`}>{tr(capabilityGuidance[setting.key])}</small></span>
      <button className="arkme-automatic-ai-switch" type="button" role="switch" aria-label={settingLabel(setting)} aria-describedby={`${titleId}-${setting.key}-guidance`} aria-checked={setting.enabled} disabled={loading || saving}
        onClick={() => setting.enabled ? void save(setting, false) : setConfirm(setting)}><span aria-hidden="true" /></button>
    </div>)}
    {retryProfile && profile && !loading && <button type="button" disabled={saving} onClick={() => { void save(profile, true) }}>{tr('个人档案已授权，重试启动分析')}</button>}
    {confirm && loadedScope === accountScope && <ArkmeConfirmDialog titleId={titleId} title={tr('开启功能')} busy={saving} onClose={() => setConfirm(undefined)}
      description={<>{tr(confirm.title.replaceAll('阿森', 'Arko'))}：{tr(automaticCapabilityDescriptions[confirm.key])}</>}
      confirmLabel={tr('同意并开启')} busyLabel={tr('正在开启…')} onConfirm={() => { void save(confirm, true) }} />}
  </section>
}
