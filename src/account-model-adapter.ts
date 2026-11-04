import type { Context } from '@deepseek-ai/cordis'
import { LlmAdapter, LlmError, resolveRetryPolicy, type GenerateOptions, type LlmModelInfo, type LlmResolvedModelInfo, type PreparedAdapterCall, type StreamChunk } from '@deepseek-ai/dsh-llm'
import { PiAiAdapter, type ResolvedPiAiProviderProfile } from '@deepseek-ai/dsh-llm-pi-ai'
import { createProvider, type Provider } from '@earendil-works/pi-ai/models'
import type { Api, Model } from '@earendil-works/pi-ai'
import { openAICompletionsApi } from '@earendil-works/pi-ai/api/openai-completions.lazy'
import { openAIResponsesApi } from '@earendil-works/pi-ai/api/openai-responses.lazy'
import { anthropicMessagesApi } from '@earendil-works/pi-ai/api/anthropic-messages.lazy'
import { createHash, randomUUID } from 'node:crypto'
import type { AccountModel, AccountModelSettings } from './account-models.js'
import { readSessionEvents } from './dsh-session-events.js'
import { turnOperationId } from './managed-ai/operation.js'
import type { ArkmeService } from './arkme-service.js'

export const ACCOUNT_MODEL_PROVIDER = 'arkme-user-api'
const retry = resolveRetryPolicy({ mode: 'normal', maxRetries: 0 }, 'Arkme account models')
export interface AccountModelAdapterOwner {
  accountModels(scope: string, signal?: AbortSignal): Promise<AccountModelSettings>
  currentScope(): Promise<string>
  bearer(): Promise<string>
  operation?(options:GenerateOptions):string|undefined
}
function info(model: AccountModel): LlmResolvedModelInfo {
  return { provider: ACCOUNT_MODEL_PROVIDER, id: model.route, name: model.name, description: '自提供 API · 使用提供方账号额度', inputModalities: model.capabilities.images ? ['text', 'image'] : ['text'], context: { contextWindow: model.capabilities.context_tokens }, defaultMaxTokens: model.capabilities.output_tokens }
}

export class AccountModelAdapter extends LlmAdapter {
  constructor(private readonly owner: AccountModelAdapterOwner, private readonly baseUrl: string, private readonly attachments?: NonNullable<ConstructorParameters<typeof PiAiAdapter>[0]['resolveAttachments']>) { super() }
  providerInfo(provider: string) { return { id:provider, name: '自提供模型', description: '账号绑定 API，可在即我设置中管理' } }
  retryPolicy() { return retry }
  async listModels(): Promise<readonly LlmModelInfo[]> {
    try { const data = await this.owner.accountModels(await this.owner.currentScope()); return data.models.filter(model => !model.disabled && model.execution === 'cloud' && model.capabilities.stream && model.capabilities.tools).map(info) } catch { return [] }
  }
  private async selected(id: string, signal?: AbortSignal): Promise<{ model: AccountModel; scope: string }> {
    const scope = await this.owner.currentScope(), data = await this.owner.accountModels(scope, signal)
    const model = data.models.find(model => model.route === id && !model.disabled && model.execution === 'cloud')
    if (!model || !data.enabled || !model.capabilities.tools || !model.capabilities.stream) throw new LlmError('账号模型不可用，请到即我设置检查绑定', 'MODEL_UNAVAILABLE')
    return { model, scope }
  }
  async resolveModel(_provider: string, id: string, signal?: AbortSignal): Promise<LlmResolvedModelInfo> { return info((await this.selected(id, signal)).model) }
  private readonly turns = new Map<string, AccountModel>()
  releaseOperation(operation:string){for(const key of this.turns.keys())if(key.startsWith(`${operation}:`))this.turns.delete(key)}
  async prepareCall(_provider: string, id: string, signal?: AbortSignal): Promise<PreparedAdapterCall> {
    const { model, scope } = await this.selected(id, signal), token = await this.owner.bearer()
    if (await this.owner.currentScope() !== scope) throw new LlmError('账号已切换，请重新选择模型', 'ACCOUNT_CHANGED')
    return { model: info(model), stream: options => this.turnStream(model, scope, token, options) }
  }
  private async delegate(model: AccountModel, token: string, operation: string, signal?: AbortSignal): Promise<PreparedAdapterCall> {
    const id = model.route
    const api: Api = model.protocol === 'openai-chat' ? 'openai-completions' : model.protocol
    const endpoint = `${this.baseUrl.replace(/\/+$/, '')}/api/v1/user-models`
    const descriptor: Model<Api> = { id: model.route, name: model.name, api, provider: ACCOUNT_MODEL_PROVIDER, baseUrl: endpoint, reasoning: false, input: model.capabilities.images ? ['text', 'image'] : ['text'], contextWindow: model.capabilities.context_tokens, maxTokens: model.capabilities.output_tokens, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }
    const protocol = api === 'openai-completions' ? openAICompletionsApi() : api === 'openai-responses' ? openAIResponsesApi() : anthropicMessagesApi()
    const provider: Provider = createProvider({ id: ACCOUNT_MODEL_PROVIDER, name: '自提供模型', baseUrl: endpoint, models: [descriptor], api: protocol, auth: { apiKey: { name: '即我账号', resolve: async ({ credential }) => ({ auth: { apiKey: credential?.key ?? token }, source: 'Arkme account' }) } } })
    const profile: ResolvedPiAiProviderProfile = {
      provider: ACCOUNT_MODEL_PROVIDER, displayName: '自提供模型', api, baseURL: endpoint, piProvider: provider,
      headers: { Authorization: `Bearer ${token}`, 'X-Arkme-Binding-Route': model.version_route, 'X-Arkme-Call-Id': randomUUID(), 'X-Arkme-Operation-Id': operation },
      timeoutMs: 120000, streamIdleTimeoutMs: 120000, maxRequestImageBytes: 6 << 20, requestImagePixelBudget: 4_194_304, requestImageMaxBytes: 1 << 20,
      retryPolicy: retry, modelErrors: new Map(), configuredMaxTokens: new Map([[model.route, model.capabilities.output_tokens]]),
    }
    // Native codecs own tools, protocol replay state, images and reasoning.
    // This adapter supplies only account identity and a frozen gateway route.
    const delegate = new PiAiAdapter({ profiles: () => new Map([[ACCOUNT_MODEL_PROVIDER, profile]]), resolveApiKey: async () => token,
      auth: { credentials: { read: async () => undefined, list: async () => [], modify: async () => { throw new Error('Account model OAuth is not supported') }, delete: async () => {} }, authContext: { env: async () => undefined, fileExists: async () => false } },
      ...(this.attachments ? { resolveAttachments: this.attachments } : {}),
    })
    const prepared = await delegate.prepareCall(ACCOUNT_MODEL_PROVIDER, id, signal)
    return prepared
  }
  private async *turnStream(current: AccountModel, scope: string, token: string, options: GenerateOptions): AsyncIterable<StreamChunk> {
    if (await this.owner.currentScope() !== scope) throw new LlmError('账号已切换，请重新选择模型', 'ACCOUNT_CHANGED')
    const lastUser = [...options.messages].reverse().find(message => message.role === 'user' && 'id' in message)
    // Durable user identity groups every tool step into one logical operation.
    // Request-only inputs have no durable turn and are intentionally independent.
    const operation = this.owner.operation?.(options) ?? createHash('sha256').update(JSON.stringify([scope,options.sessionId,lastUser && 'id' in lastUser ? lastUser.id : randomUUID(),options.purpose])).digest('hex')
    const key = `${operation}:${current.uid}`
    let model = this.turns.get(key)
    if (!model) {
      if (this.turns.size >= 512) throw new LlmError('模型任务快照已达本机上限，请重启 Host 后继续新任务', 'MODEL_LIMIT')
      model = structuredClone(current); this.turns.set(key,model)
    }
    if (!model.capabilities.stream) throw new LlmError('该模型不支持流式对话', 'MODEL_UNAVAILABLE')
    const prepared = await this.delegate(model,token,operation,options.signal)
    yield* prepared.stream({...options,maxTokens:Math.min(options.maxTokens ?? model.capabilities.output_tokens,model.capabilities.output_tokens)})
  }
  async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> { yield* (await this.prepareCall(options.provider, options.model, options.signal)).stream(options) }
}

export function registerAccountModelAdapter(ctx: Context, service: ArkmeService, baseUrl: string, scope: () => Promise<string>) {
  const adapter = new AccountModelAdapter({ accountModels: (scope, signal) => service.accountModels(scope, signal), currentScope: scope, bearer: async () => (await service.resolveManagedAccessCredential()).reveal(), operation: options=>{const session=options.sessionId?ctx.get('sessions')?.get(options.sessionId):undefined;if(!session||options.purpose==='session-title')return undefined;const start=readSessionEvents(session).findLast(event=>event.type==='turn/start'||event.type==='turn/end');return start?.type==='turn/start'?turnOperationId(session,start):undefined} }, baseUrl, () => ctx.get('attachments'))
  ctx.on('session/event',(session,event)=>{if(event.type!=='turn/end')return;const start=readSessionEvents(session).findLast(item=>item.type==='turn/start'&&item.data.turn===event.data.turn);if(start?.type==='turn/start')adapter.releaseOperation(turnOperationId(session,start))},{global:true})
  const registration = ctx.llm.registerAdapter([ACCOUNT_MODEL_PROVIDER], adapter)
  ctx.effect(() => { const refresh=()=>registration.replace([ACCOUNT_MODEL_PROVIDER]);const stop=service.onAccountModelsChanged(refresh), stopScope=service.accountScope.subscribe(refresh);return ()=>{stop();stopScope()} }, 'dsh-arkme: account model directory')
  return registration
}

export function registerAccountModelDefault(ctx: Context, service: ArkmeService, store: import('./keychain-store.js').ArkmeSecureValueStore, scope: () => Promise<string>) {
  ctx.inject(['agentDefaultModel'], defaults => {
    let active = true, serial: Promise<void> = Promise.resolve()
    const sync = () => {
      const update = async () => {
        const currentScope = await scope()
        const nativeDefault = defaults.get('agentDefaultModel') as import('@deepseek-ai/dsh-agent-default-model').AgentDefaultModelConfig
        const previousScope=await store.read('active-account-default')
        if(previousScope && previousScope!==currentScope){const prior=await store.read(`system-default:${previousScope}`);if(prior&&active&&await scope()===currentScope)await nativeDefault.saveSelection(JSON.parse(prior));await store.delete('active-account-default')}
        const settings = await service.accountModels(currentScope)
        if (!active || !settings.enabled || await scope() !== currentScope) return
        const route = settings.preferences.scenes.dsh || settings.preferences.default_route
        const model = settings.models.find(model => model.route === route && !model.disabled)
        const key = `system-default:${currentScope}`
        const previous = await store.read(key)
        if (model) {
          if (!previous) await store.write(key, JSON.stringify(nativeDefault.currentSelection()))
          const selected = model.execution === 'cloud' ? { provider: ACCOUNT_MODEL_PROVIDER, model: model.route } : { provider: model.host_provider!, model: model.model_key }
          if (await scope() !== currentScope || !active) return
          await nativeDefault.saveSelection(selected)
          await store.write('active-account-default',currentScope)
        } else if ((!route || route === 'system-default') && previous) {
          if (await scope() !== currentScope || !active) return
          await nativeDefault.saveSelection(JSON.parse(previous) as import('@deepseek-ai/dsh-agent').ModelSelection)
          await store.delete(key)
          await store.delete('active-account-default')
        }
      }
      serial = serial.then(update, update).catch(() => undefined)
    }
    sync()
    const stop = service.onAccountModelsChanged(sync), stopScope = service.accountScope.subscribe(sync)
    defaults.effect(() => () => { active = false; stop(); stopScope() }, 'dsh-arkme: account model default selection')
  })
}
