import type { AccountModelSettings, AccountModelSave, AccountModelPreferences, ModelUsagePage, ModelUsageQuery } from '../account-models.js'
import { ArkmePluginError, type ServiceRuntime } from './service.js'
import { accountModelSupportsScene } from '../account-models.js'
import {parseModelUsagePage} from './model-usage-contract.js'

export class AccountModelService {
  constructor(private readonly runtime: ServiceRuntime) {}
  async request<T>(scope: string, path: string, body: Record<string, unknown>, signal?: AbortSignal): Promise<T> {
    signal?.throwIfAborted()
    const session = await this.runtime.requireSession(), refreshToken=session.refreshToken
    if (`${this.runtime.config.environment}:${session.userId}` !== scope) throw new ArkmePluginError('model-account-changed', '账号已切换，请重新打开模型设置', false, 409)
    const value = await this.runtime.authenticatedIntelligentPost<T>(`/api/v1/user-models/${path}`, body, session, signal)
    signal?.throwIfAborted()
    const current = await this.runtime.requireSession()
    if (`${this.runtime.config.environment}:${current.userId}` !== scope || current.refreshToken !== refreshToken) throw new ArkmePluginError('model-account-changed', '账号已切换，请重新打开模型设置', false, 409)
    return value
  }
  async settings(scope: string, signal?: AbortSignal): Promise<AccountModelSettings> {
    const data = await this.request<AccountModelSettings>(scope, 'settings/query', {}, signal)
    if (!Number.isSafeInteger(data.revision) || data.revision < 0 || !Array.isArray(data.models) || data.models.length > 32 || !Array.isArray(data.scenes) || data.scenes.length > 128) throw new ArkmePluginError('model-settings-invalid', '模型设置未完整返回，请刷新', true, 502)
    if (!data.preferences || typeof data.preferences.default_route!=='string' || !data.preferences.scenes || typeof data.preferences.scenes!=='object') throw new ArkmePluginError('model-settings-invalid','模型设置未完整返回，请刷新',true,502)
    // Whitelist every field before configuration crosses into the Web client.
    const models=data.models.map(model=>{
      const c=model.capabilities
      if(!c || !Number.isSafeInteger(c.context_tokens)||!Number.isSafeInteger(c.output_tokens))throw new ArkmePluginError('model-settings-invalid','模型能力未完整返回',true,502)
      return {uid:model.uid,route:model.route,version_route:model.version_route,name:model.name,disabled:model.disabled,execution:model.execution,protocol:model.protocol,base_url:model.base_url,model_key:model.model_key,...(model.connector_id?{connector_id:model.connector_id}:{}),...(model.host_provider?{host_provider:model.host_provider}:{}),key_configured:model.key_configured,capabilities:{text:c.text,images:c.images,tools:c.tools,json:c.json,stream:c.stream,context_tokens:c.context_tokens,output_tokens:c.output_tokens}}
    })
    return {accountScope:scope,revision:data.revision,enabled:data.enabled,models,connectors:(data.connectors??[]).map(item=>({uid:item.uid,name:item.name,revoked:item.revoked})),preferences:{default_route:data.preferences.default_route,scenes:Object.fromEntries(Object.entries(data.preferences.scenes).filter(([key,value])=>key.length<=96&&typeof value==='string'&&value.length<=256)),points_fallback:false},scenes:data.scenes.map(item=>({key:item.key,name:item.name,group:item.group,biz_code:item.biz_code,tools:item.tools,images:item.images,json:item.json,...(item.stream === true ? { stream: true } : {})}))}
  }
  async save(scope: string, input: AccountModelSave, signal?: AbortSignal) {
    if (input.execution === 'cloud' && input.protocol === 'openai-responses' && input.capabilities.output_tokens < 16) {
      let endpoint: URL | undefined
      try { endpoint = new URL(input.base_url.trim()) } catch { /* The owner validates malformed endpoints. */ }
      if (endpoint?.origin === 'https://api.openai.com' && endpoint.pathname.replace(/\/+$/, '') === '/v1') {
        throw new ArkmePluginError('model-output-limit', 'OpenAI Responses 的输出上限至少为 16 Token，请调整后保存', false, 400)
      }
    }
    if (input.uid) {
      const settings = await this.settings(scope, signal)
      const current = settings.models.find(model => model.uid === input.uid)
      if (current) {
        const updated = { ...current, capabilities: input.capabilities }
        for (const scene of settings.scenes) {
          const route = settings.preferences.scenes[scene.key] || settings.preferences.default_route
          if (route === current.route && accountModelSupportsScene(current, scene) && !accountModelSupportsScene(updated, scene)) {
            throw new ArkmePluginError('model-capability-mismatch', `该模型正在用于${scene.name}，请先为该场景选择其他模型，再修改能力`, false, 400)
          }
        }
      }
    }
    return await this.request<AccountModelSettings>(scope, 'settings/save', input as unknown as Record<string, unknown>, signal)
  }
  async preferences(scope: string, revision: number, preferences: AccountModelPreferences, signal?: AbortSignal) {
    // Official selections keep the existing single write. The owner still
    // validates revisions; the extra read only explains account capabilities.
    const routes = [preferences.default_route, ...Object.values(preferences.scenes)]
    if (routes.some(route => typeof route === 'string' && route.startsWith('user-api/'))) {
      const settings = await this.settings(scope, signal)
      if (settings.revision !== revision) throw new ArkmePluginError('model-settings-conflict', '配置已更新，请刷新后检查当前选择', true, 409)
      for (const scene of settings.scenes) {
        const next = preferences.scenes[scene.key] || preferences.default_route
        const previous = settings.preferences.scenes[scene.key] || settings.preferences.default_route
        const model = settings.models.find(item => item.route === next)
        if (next !== previous && model && !accountModelSupportsScene(model, scene)) {
          throw new ArkmePluginError('model-capability-mismatch', `所选模型无法用于${scene.name}，请为该场景单独选择支持所需能力的模型`, false, 400)
        }
      }
    }
    return await this.request<AccountModelSettings>(scope, 'preferences/save', { expected_revision: revision, preferences }, signal)
  }
  async disable(scope: string, revision: number, uid: string, disabled: boolean, signal?: AbortSignal) { return await this.request<AccountModelSettings>(scope, 'settings/disable', { expected_revision: revision, uid, disabled }, signal) }
  async usage(scope: string, query: ModelUsageQuery, signal?: AbortSignal): Promise<ModelUsagePage> { return parseModelUsagePage(await this.request<unknown>(scope, 'usage/query', query as Record<string, unknown>, signal),scope) }
}
