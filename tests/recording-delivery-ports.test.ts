import { expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import { dispatchArkmeHostOperation } from '../src/host-api.js'
import { createArkmeSdk } from '../src/sdk/index.js'
import { registerArkmeTools, type ArkmeToolPorts } from '../src/tools/index.js'

const query = { scope: 'active' as const, toMillis: 1800000000000, limit: 20, offset: 0 }
it('uses one bounded read contract in SDK and Host; cancellation and unknown capability fail closed', async () => {
  const calls: unknown[] = []
  const sdk = createArkmeSdk({ fetchImpl: async (_url, init) => {
    const input = JSON.parse(String(init?.body)); calls.push(input)
    return new Response(JSON.stringify({ ok: true, value: input.operation === 'provider.capabilities' ? { contractVersion: 1, features: { recordingDeliveryV1: true } } : { items: [], offset: 0, hasMore: false } }))
  } })
  expect(await sdk.recordingDeliveryPage(query)).toEqual({ items: [], offset: 0, hasMore: false })
  expect(calls).toEqual([{ operation: 'provider.capabilities' }, { operation: 'recordings.delivery.page', params: query }])
  const owner = { recordingDeliveryPage: vi.fn(async () => ({ items: [] })) }
  const signal = new AbortController().signal
  await dispatchArkmeHostOperation(owner as never, 'recordings.delivery.page', { ...query, userId: 99 }, undefined, undefined, undefined, undefined, signal)
  expect(owner.recordingDeliveryPage).toHaveBeenCalledWith(query, signal)
  await expect(sdk.recordingDeliveryPage({ ...query, limit: 101 })).rejects.toThrow('参数无效')
  await expect(sdk.recordingDeliveryPage(query, AbortSignal.abort())).rejects.toThrow()
  sdk.dispose(); await expect(sdk.recordingDeliveryPage(query)).rejects.toThrow()
  expect(calls).toHaveLength(2)
  const old = createArkmeSdk({ fetchImpl: async () => new Response(JSON.stringify({ ok: true, value: { contractVersion: 1, features: {} } })) })
  await expect(old.recordingDeliveryPage(query)).rejects.toThrow('不支持'); old.dispose()
})
it('registers and executes through the official DSH tool runtime without a write or import command', async () => {
  const ctx = new Context()
  await ctx.plugin(ToolRuntime); await ctx.plugin(SystemPrompt)
  const recordingDeliveryPage = vi.fn(async () => ({ items: [], offset: 0, hasMore: false }))
  const fiber = await ctx.plugin(Object.assign((c: Context) => registerArkmeTools(c, { recordingDeliveryPage } as unknown as ArkmeToolPorts, 'business'), { inject: ['tools', 'systemPrompt'] }))
  try {
    expect(ctx.tools.schemas().some(t => t.name === 'arkme_recording_delivery')).toBe(true)
    const args = { scope: 'active', to_millis: query.toMillis, limit: 20, offset: 0 }
    const result = await ctx.tools.execute({ name: 'arkme_recording_delivery', callId: ToolCallId('delivery-read'), arguments: args, signal: new AbortController().signal })
    expect(result.isError).not.toBe(true)
    expect(recordingDeliveryPage).toHaveBeenCalledWith(query, expect.any(AbortSignal))
    const invalid = await ctx.tools.execute({ name: 'arkme_recording_delivery', callId: ToolCallId('delivery-invalid'), arguments: { ...args, limit: 101 }, signal: new AbortController().signal })
    expect(invalid.isError).toBe(true); expect(recordingDeliveryPage).toHaveBeenCalledOnce()
  } finally { await fiber.dispose() }
})
