import { useEffect, useRef, useState, type FormEvent } from 'react'
import { arkoModelCache } from './arko-model-cache.js'
import { accountModelEffectiveRoute, accountModelSupportsScene, type AccountModel, type AccountModelPreferences, type AccountModelSave, type AccountModelSettings } from '../account-models.js'
import type { UnifiedModelCatalog } from '../model-directory.js'
import { callArkme } from './api.js'
import { tr } from './locale.js'
import { AccountModelUsage } from './AccountModelUsage.js'
import { accountModelRetryParams, isAccountModelConflict } from './account-model-save-recovery.js'
import css from './account-models.css?inline'

type Tab = 'custom' | 'preferences' | 'usage'
const defaultForm = (): AccountModelSave => ({ uid: '', expected_revision: 0, name: '', execution: 'cloud', protocol: 'openai-chat', base_url: '', model_key: '', connector_id: '', host_provider: '', api_key: '', capabilities: { text: true, images: false, tools: true, json: true, stream: true, context_tokens: 32768, output_tokens: 4096 } })
function message(error: unknown): string {
  const value = error as { message?: unknown; body?: { code?: string } }
  // This owner-generated message lists every affected function; do not hide
  // the list behind a generic error when several functions share a model.
  return typeof value?.message === 'string' && (value.message.length < 300 || value.body?.code === 'model-capability-mismatch') ? value.message : tr('暂时无法完成，请稍后重试')
}

export function AccountModelsPanel({ scope, tab }: { scope: string; tab: Tab }) {
  const [data, setData] = useState<AccountModelSettings>(), [loadError, setLoadError] = useState(''), [loading, setLoading] = useState(true), [busy, setBusy] = useState(false), [notice, setNotice] = useState('')
  const [form, setForm] = useState<AccountModelSave>(), [consent, setConsent] = useState(false), [native, setNative] = useState<UnifiedModelCatalog>()
  const [preferences, setPreferences] = useState<AccountModelPreferences>(), [preferenceRevision, setPreferenceRevision] = useState<number>()
  const [usageVisited, setUsageVisited] = useState(tab === 'usage')
  const alive = useRef(true), request = useRef<AbortController>()
  const load = async (signal?: AbortSignal) => {
    setLoading(true); setLoadError('')
    try {
      const value = await callArkme<AccountModelSettings>('models.account.query', { expectedAccountScope: scope }, signal)
      if (signal?.aborted || !alive.current || value.accountScope !== scope) return
      setData(value); setPreferences(current => current ?? structuredClone(value.preferences)); setPreferenceRevision(current => current ?? value.revision)
      return value
    } catch (error) { if (!signal?.aborted && alive.current) setLoadError(message(error)) }
    finally { if (!signal?.aborted && alive.current) setLoading(false) }
  }
  useEffect(() => {
    alive.current = true
    const controller = new AbortController(); void load(controller.signal)
    void callArkme<UnifiedModelCatalog>('models.directory', { expectedAccountScope: scope }, controller.signal).then(value => { if (!controller.signal.aborted && value.accountScope === scope) setNative(value) }, () => {})
    return () => { alive.current = false; controller.abort(); request.current?.abort() }
  }, [scope])
  useEffect(() => { if (tab === 'usage') setUsageVisited(true) }, [tab])
  const mutate = async (operation: 'models.account.save' | 'models.account.disable' | 'models.preferences.save' | 'models.connector.enroll', params: Record<string, unknown>, done?: () => void) => {
    if (busy || request.current) return
    const controller = new AbortController(); request.current = controller; setBusy(true); setNotice('')
    let refreshed = false
    try {
      let value: AccountModelSettings
      try {
        value = await callArkme<AccountModelSettings>(operation, { expectedAccountScope: scope, ...params }, controller.signal)
      } catch (error) {
        if (!isAccountModelConflict(error) || controller.signal.aborted || !alive.current) throw error
        const latest = await load(controller.signal)
        refreshed = true
        const retry = latest && accountModelRetryParams(operation, params, data, latest)
        if (!retry || controller.signal.aborted || !alive.current) throw error
        // One retry, only after a definite rejection. The owner still checks CAS
        // and capabilities; a second conflict or an uncertain result stops here.
        refreshed = false
        value = await callArkme<AccountModelSettings>(operation, { expectedAccountScope: scope, ...retry }, controller.signal)
      }
      if (controller.signal.aborted || !alive.current || value.accountScope !== scope) return
      if (operation !== 'models.connector.enroll') arkoModelCache.invalidate(scope)
      setData(value); setNotice(tr('已保存，后续新任务生效')); if(form && operation==='models.connector.enroll')setForm({...form,expected_revision:value.revision}); if(preferences && data && JSON.stringify(preferences)===JSON.stringify(data.preferences)){setPreferences(structuredClone(value.preferences));setPreferenceRevision(value.revision)} done?.()
      if (operation === 'models.preferences.save') { setPreferences(structuredClone(value.preferences)); setPreferenceRevision(value.revision) }
    } catch (error) { if (!controller.signal.aborted && alive.current) { setNotice(isAccountModelConflict(error) ? tr('设置已发生变化，你的修改已保留。') : message(error)); if (!refreshed) await load(controller.signal) } }
    finally { if (request.current === controller) request.current = undefined; if (!controller.signal.aborted && alive.current) setBusy(false) }
  }
  const beginEdit = (model?: AccountModel) => {
    setNotice(''); setConsent(false)
    setForm(model ? { uid: model.uid, expected_revision: data!.revision, name: model.name, execution: model.execution, protocol: model.protocol, base_url: model.base_url, model_key: model.model_key, connector_id: model.connector_id ?? '', host_provider: model.host_provider ?? '', capabilities: { ...model.capabilities }, api_key: '' } : { ...defaultForm(), expected_revision: data!.revision })
  }
  const submit = (event: FormEvent) => {
    event.preventDefault(); if (!form || form.execution === 'cloud' && !consent) return
    const confirmLatest = (event.nativeEvent as SubmitEvent | undefined)?.submitter?.getAttribute('data-confirm-latest') === 'true'
    void mutate('models.account.save', { input: confirmLatest ? { ...form, expected_revision: data!.revision } : form }, () => { setForm(undefined); setConsent(false) })
  }
  const names = new Map(data?.scenes.map(scene => [scene.key, scene.name]))
  const nativeModels = native?.models.filter(model => model.origin === 'user-provided' && model.dsh && !model.dsh.provider.startsWith('arkme-user-')) ?? []
  return <div className="arkme-account-models"><style>{css}</style>
    {tab !== 'usage' && <>
      <div className="arkme-account-models-top"><span>{tr('账号级模型 · 桌面端与 App 共用')}</span><button type="button" disabled={loading || busy} onClick={() => void load()}>{tr('刷新')}</button></div>
      {loadError && <div className="arkme-account-models-notice" role="alert"><p>{loadError}</p><p>{tr('原有本机模型仍可在下方管理；全场景绑定需要当前服务支持。')}</p><button type="button" onClick={() => void load()}>{tr('重试')}</button></div>}
      {loading && !data && <p role="status">{tr('正在读取账号模型…')}</p>}
      {data && !data.enabled && <p className="arkme-account-models-notice">{tr('当前服务尚未开放全场景模型绑定，原有本机配置可继续使用。')}</p>}
      {notice && tab === 'custom' && !form && <p className="arkme-account-models-notice" role="status">{notice}</p>}
    </>}
    <div hidden={tab !== 'custom'}>
      {data?.enabled && <>
        <div className="arkme-account-models-heading"><div><h3>{tr('全场景模型')}</h3><p>{tr('接入自己的 API，可用于对话、识别和总结。')}</p></div><button type="button" className="primary" disabled={busy || !!form} onClick={() => beginEdit()}>{tr('添加模型')}</button></div>
        {data.models.length === 0 && !form && <p className="arkme-account-models-empty">{tr('还没有绑定账号模型。添加后，可在「使用偏好」中设为默认。')}</p>}
        {data.models.map(model => <article key={model.uid} className="arkme-account-model-row"><div><strong>{model.name}</strong><span className="arkme-account-model-tag">{tr(model.execution === 'cloud' ? '云端可用' : '需要本机在线')}</span>{model.disabled && <span className="arkme-account-model-tag">{tr('已停用')}</span>}<p>{model.model_key} · {model.capabilities.context_tokens.toLocaleString()} Token · {tr(model.capabilities.tools ? '支持工具' : '纯文本')} {model.capabilities.images && `· ${tr('支持图片')}`}</p></div><div><button type="button" disabled={busy} onClick={() => beginEdit(model)}>{tr('编辑')}</button><button type="button" disabled={busy} onClick={() => void mutate('models.account.disable', { revision: data.revision, uid: model.uid, disabled: !model.disabled })}>{tr(model.disabled ? '启用' : '停用')}</button></div></article>)}
        {form && <form className="arkme-account-model-form" onSubmit={submit} aria-label={tr(form.uid ? '编辑账号模型' : '添加账号模型')}>
          <h3>{tr(form.uid ? '编辑模型' : '添加模型')}</h3>
          <div className="arkme-account-model-form-grid">
            <label>{tr('显示名称')}<input disabled={busy} required maxLength={160} value={form.name} onChange={event => setForm({ ...form, name: event.target.value })}/></label>
            <label>{tr('调用方式')}<select disabled={busy} value={form.execution} onChange={event => { setConsent(false); setForm({ ...form, execution: event.target.value as AccountModel['execution'], base_url: '', api_key: '', connector_id: '', host_provider: '' }) }}><option value="cloud">{tr('云端 API · 可自动运行')}</option><option value="connector">{tr('本机连接器 · 本机在线时运行')}</option></select></label>
            {form.execution === 'cloud' ? <>
              <label>{tr('API 协议')}<select disabled={busy} value={form.protocol} onChange={event => setForm({ ...form, protocol: event.target.value as AccountModel['protocol'] })}><option value="openai-chat">OpenAI Chat Completions</option><option value="openai-responses">OpenAI Responses</option><option value="anthropic-messages">Anthropic Messages</option></select></label>
              <label>{tr('API 地址')}<input disabled={busy} required type="url" placeholder="https://api.example.com/v1" value={form.base_url} onChange={event => setForm({ ...form, base_url: event.target.value })}/></label>
              <label className="wide">API Key<input disabled={busy} type="password" autoComplete="new-password" required={!form.uid} value={form.api_key} onChange={event => setForm({ ...form, api_key: event.target.value })} placeholder={tr(form.uid ? '已保存时留空保留；修改地址或协议须重新填写' : '输入提供方 API Key')}/></label>
              <label>{tr('模型 ID')}<input disabled={busy} required maxLength={256} placeholder="provider-model-id" value={form.model_key} onChange={event => setForm({ ...form, model_key: event.target.value })}/></label>
            </> : <>
              <label>{tr('本机连接器')}<select disabled={busy} required value={form.connector_id} onChange={event => setForm({ ...form, connector_id: event.target.value })}><option value="">{tr('选择已启用的连接器')}</option>{data.connectors.filter(connector => !connector.revoked).map(connector => <option key={connector.uid} value={connector.uid}>{connector.name}</option>)}</select></label>
              <button type="button" disabled={busy} onClick={() => void mutate('models.connector.enroll', {})}>{tr('启用当前本机连接器')}</button>
              <label className="wide">{tr('本机模型')}<select disabled={busy} required value={JSON.stringify([form.host_provider, form.model_key])} onChange={event => { const [provider, model] = JSON.parse(event.target.value) as [string, string]; setForm({ ...form, host_provider: provider, model_key: model }) }}><option value={JSON.stringify(['', ''])}>{tr('选择已配置的本机模型')}</option>{nativeModels.map(model => <option key={model.id} value={JSON.stringify([model.dsh!.provider, model.dsh!.model])}>{model.name} · {model.channel}</option>)}</select></label>
              <p className="wide">{tr('API Key 保留在本机。连接器离线时任务会停止，不会切换成积分模型。')}</p>
            </>}
            <label>{tr('上下文上限 Token')}<input disabled={busy} type="number" min={1024} max={1048576} required value={form.capabilities.context_tokens} onChange={event => setForm({ ...form, capabilities: { ...form.capabilities, context_tokens: Number(event.target.value) } })}/></label>
            <label>{tr('输出上限 Token')}<input disabled={busy} type="number" min={1} max={Math.min(131072, form.capabilities.context_tokens - 1)} required value={form.capabilities.output_tokens} onChange={event => setForm({ ...form, capabilities: { ...form.capabilities, output_tokens: Number(event.target.value) } })}/></label>
          </div>
          <fieldset><legend>{tr('模型支持的能力')}</legend>{([['tools', '工具调用'], ['json', 'JSON 输出'], ['images', '图片'], ['stream', '流式输出']] as const).map(([key, label]) => <label key={key}><input disabled={busy} type="checkbox" checked={form.capabilities[key]} onChange={event => setForm({ ...form, capabilities: { ...form.capabilities, [key]: event.target.checked } })}/>{tr(label)}</label>)}</fieldset>
          {form.execution === 'cloud' && <label className="arkme-model-cloud-consent"><input disabled={busy} type="checkbox" required checked={consent} onChange={event => setConsent(event.target.checked)}/><span>{tr('同意将本次填写的 API Key 加密绑定到账号，供桌面端、App 及自动任务使用。费用由提供方账号承担。')}</span></label>}
          <p className="arkme-account-model-hint">{tr('能力与上限请以提供方说明为准。修改配置只影响后续新任务，已开始的任务使用原版本。')}</p>
          {notice && <p className="arkme-account-models-notice" role="status">{notice}</p>}
          {form.expected_revision!==data.revision && !notice && <p className="arkme-account-models-notice">{tr('设置已发生变化，请确认本次修改。')}</p>}
          <div className="arkme-account-model-actions"><button type="button" disabled={busy} onClick={() => setForm(undefined)}>{tr('取消')}</button><button type="submit" data-confirm-latest={form.expected_revision!==data.revision ? 'true' : undefined} className="primary" disabled={busy || form.execution === 'cloud' && !consent}>{tr(busy ? '保存中…' : form.expected_revision!==data.revision ? '确认保存我的修改' : '保存模型')}</button></div>
        </form>}
      </>}
    </div>
    <div hidden={tab !== 'preferences'}>{data?.enabled && preferences && <>
      <h3>{tr('默认使用模型')}</h3><p className="arkme-account-model-hint">{tr('本次任务的明确选择优先，其次是场景设置，最后是全局默认。')}</p>
      <label className="arkme-account-model-preference">{tr('全局默认')}<select value={preferences.default_route || 'system-default'} disabled={busy} onChange={event => setPreferences({ ...preferences, default_route: event.target.value })}><option value="system-default">{tr('即我官方 · 使用各功能默认模型')}</option>{data.models.filter(model => !model.disabled || model.route===preferences.default_route).map(model => <option key={model.uid} value={model.route} disabled={model.disabled}>{model.name} · {tr(model.disabled?'已停用':'自提供')}</option>)}</select></label>
      <h3>{tr('按场景设置')}</h3>
      {([true,false] as const).map(common=>{const primary=new Set(['dsh','arko','arrangement','profile','goals','recording-summary','recording-timeline']);const scenes=data.scenes.filter(scene=>primary.has(scene.key)===common).sort((a,b)=>common?[...primary].indexOf(a.key)-[...primary].indexOf(b.key):0);const rows=<>{scenes.map(scene => <label className="arkme-account-model-preference" key={scene.key}><span>{scene.name}<small>{names.get(scene.key) && preferences.scenes[scene.key] ? tr('已单独设置') : tr('跟随全局默认')}</small></span><select value={preferences.scenes[scene.key] || ''} disabled={busy} onChange={event => { const scenes = { ...preferences.scenes }; if (event.target.value) scenes[scene.key] = event.target.value; else delete scenes[scene.key]; setPreferences({ ...preferences, scenes }) }}><option value="">{tr('跟随全局默认')}</option><option value="system-default">{tr('即我官方 · 场景默认模型')}</option>{preferences.scenes[scene.key] && preferences.scenes[scene.key] !== 'system-default' && !data.models.some(model => model.route === preferences.scenes[scene.key]) && <option value={preferences.scenes[scene.key]}>{tr('已选择的官方模型')} · {preferences.scenes[scene.key]}</option>}{data.models.map(model => <option key={model.uid} value={model.route} disabled={!accountModelSupportsScene(model, scene)}>{model.name}{!accountModelSupportsScene(model, scene) ? ` · ${tr(model.disabled ? '已停用' : '能力不满足')}` : ''}</option>)}</select>{(() => { const model = data.models.find(model => model.route === accountModelEffectiveRoute({ ...data, preferences }, scene.key)); return model && !accountModelSupportsScene(model, scene) ? <small className="warning">{(scene.key === 'dsh' && !model.disabled ? tr('DSH 对话需要同时支持工具调用和流式输出，请重新选择。') : tr('当前有效模型无法完成此场景，请重新选择。'))}</small> : null })()}</label>)}</>;return common?<div key="common">{rows}</div>:<details key="more"><summary>{tr('更多场景')}（{scenes.length}）</summary>{rows}</details>})}
      <p className="arkme-account-model-hint">{tr('自提供模型调用失败时停止，不自动切换到积分模型。')}</p>
      {notice && <p className="arkme-account-models-notice" role="status">{notice}</p>}
      {preferenceRevision!==data.revision && !notice && <p className="arkme-account-models-notice">{tr('设置已发生变化，请确认本次修改。')}</p>}
      <div className="arkme-account-model-actions"><button type="button" disabled={busy} onClick={() => { setPreferences(structuredClone(data.preferences)); setPreferenceRevision(data.revision); setNotice('') }}>{tr('恢复已保存设置')}</button><button type="button" className="primary" disabled={busy} onClick={() => void mutate('models.preferences.save', { revision: data.revision, preferences })}>{tr(busy ? '保存中…' : preferenceRevision!==data.revision ? '确认保存我的修改' : '保存使用偏好')}</button></div>
    </>}</div>
    <div hidden={tab !== 'usage'}>{usageVisited && <AccountModelUsage scope={scope} settings={data}/>}</div>
  </div>
}
