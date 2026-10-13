import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { automaticCapabilityDescriptions, type ArkmeCapabilitySetting, type ArkmeCapabilitySettings } from '../capabilities.js'
import { callArkme } from './api.js'
import { ArkmeConfirmDialog } from './ArkmeConfirmDialog.js'
import { tr, useArkmeLocale } from './locale.js'

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
  return <section className="arkme-automatic-ai" aria-label={tr('自动 AI')}>
    <h3>{tr('自动 AI')}</h3>
    <p>{tr('按需开启，使用时消耗 AI 积分。')}</p>
    {error && <p role="alert">{error}</p>}
    {loading && <p role="status">{tr('正在读取设置…')}</p>}
    {!loading && !settings && <button type="button" onClick={() => { setError(''); void reload() }}>{tr('重新加载')}</button>}
    {visibleSettings?.map(setting => <div className="arkme-automatic-ai-row" key={setting.key}>
      <span>{tr(setting.title)}</span>
      <button className="arkme-automatic-ai-switch" type="button" role="switch" aria-label={tr(setting.title)} aria-checked={setting.enabled} disabled={loading || saving}
        onClick={() => setting.enabled ? void save(setting, false) : setConfirm(setting)}><span aria-hidden="true" /></button>
    </div>)}
    <details className="arkme-automatic-ai-help"><summary>{tr('使用说明')}</summary>
      <p>{tr('所有功能默认关闭，两端共享设置。开启后按实际模型用量消耗本人的 AI 积分；正常分析没有产出也计费。系统异常重试不重复收费。')}</p>
      <p>{tr('关闭后不再开始新的模型调用，已发出的调用可能完成并产生费用。已生成的内容保留。除个人档案首次分析外，不补跑开启前的历史材料。')}</p>
    </details>
    {retryProfile && profile && !loading && <button type="button" disabled={saving} onClick={() => { void save(profile, true) }}>{tr('个人档案已授权，重试启动分析')}</button>}
    {confirm && loadedScope === accountScope && <ArkmeConfirmDialog titleId={titleId} title={tr('开启自动 AI')} busy={saving} onClose={() => setConfirm(undefined)}
      description={<>{tr(confirm.title)}：{tr(automaticCapabilityDescriptions[confirm.key])}<br />{tr('开启后消耗你的 AI 积分。正常分析按实际用量计费，没有生成结果也会计费。余额不足时停止新的分析，可随时关闭。')}<br />{tr('关闭后，已开始的分析仍可能完成并计费。')}</>}
      confirmLabel={tr('同意并开启')} busyLabel={tr('正在开启…')} onConfirm={() => { void save(confirm, true) }} />}
  </section>
}
