import { Context } from '@deepseek-ai/cordis'
import { LlmRuntime } from '@deepseek-ai/dsh-llm'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ARKME_MANAGED_PROVIDER, registerManagedAiProvider } from '../src/managed-ai/adapter.js'
import { SecretValue } from '../src/secret-value.js'

function catalog(name = 'Old name'): Response {
  return Response.json({ code: 200, data: { item_ls: [{
    provider: ARKME_MANAGED_PROVIDER, public_model_code: 'stable-id', display_name: name,
    reasoning: { efforts: ['off', 'low', 'high', 'max'], default_effort: 'high' },
    context_window_tokens: '1000000', default_max_output_tokens: '256000', maximum_max_output_tokens: '384000',
    capability: { contract_version: 'text-chat-v1', input_modalities: ['text'], output_modalities: ['text'] },
  }] } })
}

afterEach(() => { vi.useRealTimers() })

describe('managed model catalog invalidation', () => {
  it('does not miss the first owner interval when initial discovery happened after registration', async () => {
    vi.useFakeTimers()
    const ctx = new Context()
    const llm = await ctx.plugin(LlmRuntime)
    let name = 'Old name'
    const fetchCatalog = vi.fn(async () => catalog(name))
    const handle = registerManagedAiProvider(ctx, {
      intelligentBaseUrl: 'https://intelligent.test', fetchImpl: fetchCatalog,
      credentialOwner: { resolveManagedAccessCredential: async () => new SecretValue('access') },
    })
    try {
      await vi.advanceTimersByTimeAsync(10_000)
      await ctx.llm.listModels(ARKME_MANAGED_PROVIDER)
      name = 'Updated name'
      await vi.advanceTimersByTimeAsync(50_000)
      expect((await ctx.llm.listModels(ARKME_MANAGED_PROVIDER))[0]?.name).toBe(name)
      expect(fetchCatalog).toHaveBeenCalledTimes(2)
    } finally { handle(); await llm.dispose() }
  })

  it('invalidates a cached client directory only when the advertised catalog changes', async () => {
    vi.useFakeTimers()
    const ctx = new Context()
    const llm = await ctx.plugin(LlmRuntime)
    let name = 'Old name'
    const fetchCatalog = vi.fn(async () => catalog(name))
    const handle = registerManagedAiProvider(ctx, {
      intelligentBaseUrl: 'https://intelligent.test', fetchImpl: fetchCatalog,
      credentialOwner: { resolveManagedAccessCredential: async () => new SecretValue('access') },
    })
    // DSH's ready client directory caches its value until adapters-updated.
    let clientName = (await ctx.llm.listModels(ARKME_MANAGED_PROVIDER))[0]!.name
    const notifications = vi.fn(async () => {
      clientName = (await ctx.llm.listModels(ARKME_MANAGED_PROVIDER))[0]!.name
    })
    ctx.on('llm/adapters-updated', notifications)
    try {
      await vi.advanceTimersByTimeAsync(60_000)
      expect(fetchCatalog).toHaveBeenCalledTimes(2)
      expect(notifications).not.toHaveBeenCalled()
      name = 'Current official name'
      await vi.advanceTimersByTimeAsync(60_000)
      expect(clientName).toBe(name)
      expect(notifications).toHaveBeenCalledTimes(1)
      expect(fetchCatalog).toHaveBeenCalledTimes(3)
      expect((await ctx.llm.resolveModelInfo(ARKME_MANAGED_PROVIDER, 'stable-id')).id).toBe('stable-id')
    } finally { handle(); await llm.dispose() }
  })

  it('recovers a client catalog whose first load failed, and withdraws expired stale metadata once', async () => {
    vi.useFakeTimers()
    const ctx = new Context()
    const llm = await ctx.plugin(LlmRuntime)
    let online = false
    const fetchCatalog = vi.fn(async () => { if (!online) throw new Error('offline'); return catalog('Recovered name') })
    const handle = registerManagedAiProvider(ctx, {
      intelligentBaseUrl: 'https://intelligent.test', fetchImpl: fetchCatalog,
      credentialOwner: { resolveManagedAccessCredential: async () => new SecretValue('access') },
    })
    const notifications = vi.fn()
    ctx.on('llm/adapters-updated', notifications)
    try {
      await expect(ctx.llm.listModels(ARKME_MANAGED_PROVIDER)).rejects.toMatchObject({ code: 'TRANSPORT' })
      online = true
      await vi.advanceTimersByTimeAsync(60_000)
      expect(notifications).toHaveBeenCalledTimes(1)
      online = false
      await vi.advanceTimersByTimeAsync(4 * 60_000)
      expect(notifications).toHaveBeenCalledTimes(1)
      await vi.advanceTimersByTimeAsync(60_000)
      expect(notifications).toHaveBeenCalledTimes(2)
      await vi.advanceTimersByTimeAsync(60_000)
      expect(notifications).toHaveBeenCalledTimes(2)
      online = true
      await vi.advanceTimersByTimeAsync(60_000)
      expect(notifications).toHaveBeenCalledTimes(3)
    } finally { handle(); await llm.dispose() }
  })

  it('does not poll before discovery or while the route is withdrawn; disposal clears the timer', async () => {
    vi.useFakeTimers()
    const ctx = new Context()
    const llm = await ctx.plugin(LlmRuntime)
    const fetchCatalog = vi.fn(async () => catalog())
    const handle = registerManagedAiProvider(ctx, {
      intelligentBaseUrl: 'https://intelligent.test', fetchImpl: fetchCatalog,
      credentialOwner: { resolveManagedAccessCredential: async () => new SecretValue('access') },
    })
    try {
      await vi.advanceTimersByTimeAsync(120_000)
      expect(fetchCatalog).not.toHaveBeenCalled()
      await ctx.llm.listModels(ARKME_MANAGED_PROVIDER)
      handle.replace([])
      await vi.advanceTimersByTimeAsync(120_000)
      expect(fetchCatalog).toHaveBeenCalledTimes(1)
      expect(ctx.llm.listProviders()).toEqual([])
      handle.replace([ARKME_MANAGED_PROVIDER])
      await vi.advanceTimersByTimeAsync(60_000)
      expect(fetchCatalog).toHaveBeenCalledTimes(2)
      handle()
      await vi.advanceTimersByTimeAsync(120_000)
      expect(fetchCatalog).toHaveBeenCalledTimes(2)
      expect(vi.getTimerCount()).toBe(0)
    } finally { handle(); await llm.dispose() }
  })

  it('aborts an in-flight background read on disposal and never publishes its late response', async () => {
    vi.useFakeTimers()
    const ctx = new Context()
    const llm = await ctx.plugin(LlmRuntime)
    let signal: AbortSignal | undefined
    let finish: (() => void) | undefined
    const fetchCatalog = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(catalog())
      .mockImplementationOnce(async (_input, init) => {
        signal = init?.signal ?? undefined
        await new Promise<void>(resolve => { finish = resolve })
        return catalog('Late response')
      })
    const handle = registerManagedAiProvider(ctx, {
      intelligentBaseUrl: 'https://intelligent.test', fetchImpl: fetchCatalog,
      credentialOwner: { resolveManagedAccessCredential: async () => new SecretValue('access') },
    })
    try {
      await ctx.llm.listModels(ARKME_MANAGED_PROVIDER)
      const notifications = vi.fn()
      ctx.on('llm/adapters-updated', notifications)
      await vi.advanceTimersByTimeAsync(60_000)
      expect(signal).toBeDefined()
      handle()
      expect(signal?.aborted).toBe(true)
      notifications.mockClear() // Registration withdrawal itself is a public event.
      finish?.()
      await vi.advanceTimersByTimeAsync(0)
      expect(notifications).not.toHaveBeenCalled()
      expect(vi.getTimerCount()).toBe(0)
    } finally { handle(); await llm.dispose() }
  })

  it('re-resolves credentials on refresh and coalesces simultaneous directory readers', async () => {
    vi.useFakeTimers()
    const ctx = new Context()
    const llm = await ctx.plugin(LlmRuntime)
    let access = 'account-a-access'
    const fetchCatalog = vi.fn(async (_input: unknown, init?: RequestInit) => {
      expect(new Headers(init?.headers).get('Authorization')).toBe(`Bearer ${access}`)
      return catalog(access === 'account-a-access' ? 'Name A' : 'Name B')
    })
    const handle = registerManagedAiProvider(ctx, {
      intelligentBaseUrl: 'https://intelligent.test', fetchImpl: fetchCatalog,
      credentialOwner: { resolveManagedAccessCredential: async () => new SecretValue(access) },
    })
    try {
      await ctx.llm.listModels(ARKME_MANAGED_PROVIDER)
      access = 'account-b-access'
      await vi.advanceTimersByTimeAsync(60_000)
      const [one, two] = await Promise.all([
        ctx.llm.listModels(ARKME_MANAGED_PROVIDER), ctx.llm.listModels(ARKME_MANAGED_PROVIDER),
      ])
      expect(one[0]?.name).toBe('Name B')
      expect(two).toEqual(one)
      expect(fetchCatalog).toHaveBeenCalledTimes(2)
    } finally { handle(); await llm.dispose() }
  })

  it('cleans up when the owning plugin is unloaded without manually disposing the registration', async () => {
    vi.useFakeTimers()
    const ctx = new Context()
    const llm = await ctx.plugin(LlmRuntime)
    const fetchCatalog = vi.fn(async () => catalog())
    const owner = await ctx.plugin(Object.assign((scope: Context) => {
      registerManagedAiProvider(scope, {
        intelligentBaseUrl: 'https://intelligent.test', fetchImpl: fetchCatalog,
        credentialOwner: { resolveManagedAccessCredential: async () => new SecretValue('access') },
      })
    }, { inject: ['llm'] }))
    try {
      await ctx.llm.listModels(ARKME_MANAGED_PROVIDER)
      await owner.dispose()
      await vi.advanceTimersByTimeAsync(120_000)
      expect(fetchCatalog).toHaveBeenCalledTimes(1)
      expect(ctx.llm.listProviders()).toEqual([])
      expect(vi.getTimerCount()).toBe(0)
    } finally { await owner.dispose(); await llm.dispose() }
  })
})
