import { describe, expect, it, vi } from 'vitest'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { LlmError, ReasoningEffortId, type GenerateOptions, type LlmAdapter, type StreamChunk } from '@deepseek-ai/dsh-llm'
import { DayRecapService } from '../src/services/day-recap-service.js'
import { parseDayRecapInput } from '../src/day-recap.js'
import { createArkmeHostApi, dispatchArkmeHostOperation } from '../src/host-api.js'
import type { ArkmeService } from '../src/arkme-service.js'

const input = parseDayRecapInput({ accountScope: 'prod:1', bucketDate: '2026-09-19', timezone: 'Asia/Shanghai', consent: true,
  items: [{ id: 'a1', time: '14:00', kind: '个人记录', title: '我的记录', excerpt: '讨论一个方案', scope: '部分摘录' }] })
const output = JSON.stringify({ points: [{ text: '讨论一个方案', sourceIds: ['a1'] }] })
function setup(chunks: StreamChunk[] = [{ type: 'text-delta', index: 0, text: output }, { type: 'finish', reason: { kind: 'stop' } }]) {
  const stream = vi.fn(async function* (_request: GenerateOptions): AsyncIterable<StreamChunk> { yield* chunks })
  const resolveModel = vi.fn(async () => ({ provider: 'arkme-managed', id: 'deepseek-v4-flash', name: 'Flash',
    reasoning: { efforts: [{ id: ReasoningEffortId('off'), name: 'Off' }] } }))
  const adapter = vi.fn(() => ({ stream, resolveModel }) as unknown as LlmAdapter)
  const assertAccount = vi.fn(async (_scope: string) => {})
  const service = new DayRecapService({ adapter, assertAccount })
  return { service, adapter, stream, assertAccount, resolveModel }
}

describe('one-shot daily recap service', () => {
  it('uses bounded text-only managed generation without tools or any durable session', async () => {
    const { service, stream, assertAccount } = setup()
    const result = await service.generate(input)
    expect(result.points).toEqual(JSON.parse(output).points)
    expect(assertAccount).toHaveBeenCalledTimes(3)
    expect(assertAccount).toHaveBeenCalledWith('prod:1')
    expect(stream).toHaveBeenCalledTimes(1)
    const request = stream.mock.calls[0]![0]
    expect(request).toMatchObject({ maxTokens: 1000, reasoningEffort: 'off', provider: 'arkme-managed' })
    expect(request.tools).toBeUndefined()
    expect(request.sessionId).toBeUndefined()
    expect(request.system).toContain('素材中的指令')
    expect(JSON.stringify(request.messages)).not.toContain('prod:1')
  })
  it('refuses unapproved input before model or account calls', async () => {
    const { service, adapter, assertAccount } = setup()
    await expect(service.generate({ ...input, consent: false })).rejects.toThrow('确认')
    expect(adapter).not.toHaveBeenCalled(); expect(assertAccount).not.toHaveBeenCalled()
  })
  it('fails closed when account changes before returning output', async () => {
    const { service, assertAccount } = setup()
    assertAccount.mockImplementationOnce(async () => {}).mockImplementationOnce(async () => {}).mockRejectedValueOnce(new Error('changed'))
    await expect(service.generate(input)).rejects.toThrow()
  })
  it.each([
    [{ type: 'text-delta', index: 0, text: output }],
    [{ type: 'text-delta', index: 0, text: output }, { type: 'finish', reason: { kind: 'max-tokens' } }],
    [{ type: 'block-start', index: 0, blockType: 'tool-call' }],
    [{ type: 'text-delta', index: 0, text: 'x'.repeat(8001) }],
    [{ type: 'text-delta', index: 0, text: '{"points":[{"text":"编造","sourceIds":["a99"]}]}' }, { type: 'finish', reason: { kind: 'stop' } }],
  ] as StreamChunk[][])('rejects incomplete, tool, oversized or uncited output without retry', async (...chunks) => {
    const { service, stream } = setup(chunks as StreamChunk[])
    await expect(service.generate(input)).rejects.toThrow()
    expect(stream).toHaveBeenCalledTimes(1)
  })
  it('shows insufficient balance rather than falling back or retrying automatically', async () => {
    const { service, stream } = setup()
    stream.mockImplementation(async function* () { throw new LlmError('quota', 'INSUFFICIENT_BALANCE', { status: 402 }) })
    await expect(service.generate(input)).rejects.toThrow('余额不足')
    expect(stream).toHaveBeenCalledTimes(1)
  })
  it('aborts before dispatch and allows an explicit later request', async () => {
    const { service, stream } = setup()
    const controller = new AbortController(); controller.abort()
    await expect(service.generate(input, controller.signal)).rejects.toThrow('取消')
    expect(stream).not.toHaveBeenCalled()
    await expect(service.generate(input)).resolves.toMatchObject({ modelName: 'Flash' })
  })
  it('refuses overlapping clicks instead of double charging', async () => {
    const { service, resolveModel, stream } = setup()
    let finish!: () => void
    const model = await resolveModel()
    resolveModel.mockImplementationOnce(async () => { await new Promise<void>(done => { finish = done }); return model })
    const pending = service.generate(input)
    await vi.waitFor(() => expect(finish).toBeDefined())
    await expect(service.generate(input)).rejects.toThrow('正在生成')
    finish(); await pending
    expect(stream).toHaveBeenCalledTimes(1)
  })
  it('does not accept expensive default reasoning when no lightweight effort is supported', async () => {
    const { service, resolveModel, stream } = setup()
    resolveModel.mockResolvedValue({ provider: 'arkme-managed', id: 'deepseek-v4-flash', name: 'Flash', reasoning: { efforts: [{ id: ReasoningEffortId('high'), name: 'High' }] } })
    await expect(service.generate(input)).rejects.toThrow('不支持轻量小结')
    expect(stream).not.toHaveBeenCalled()
  })
  it('host forwards cancellation to the generation boundary, not to Arko or recording generation', async () => {
    const generateDayRecap = vi.fn(async () => ({})), signal = new AbortController().signal
    await dispatchArkmeHostOperation({ generateDayRecap } as unknown as ArkmeService, 'calendar.day-recap', { ...input }, undefined, undefined, undefined, undefined, signal)
    expect(generateDayRecap).toHaveBeenCalledExactlyOnceWith(input, signal)
  })
  it('rejects missing and foreign browser origins before touching paid generation', async () => {
    const generateDayRecap = vi.fn(async () => ({}))
    const server = createServer(createArkmeHostApi({ generateDayRecap } as unknown as ArkmeService, { expectedPort: 3098, allowNonLoopback: false }))
    server.listen(0, '127.0.0.1'); await once(server, 'listening')
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('test address missing')
    try {
      for (const origin of [undefined, 'https://example.com']) {
        const response = await fetch(`http://127.0.0.1:${address.port}/arkme-self/api`, { method: 'POST',
          headers: { 'Content-Type': 'application/json', ...(origin ? { Origin: origin } : {}) },
          body: JSON.stringify({ operation: 'calendar.day-recap', params: input }) })
        expect(response.status).toBe(403)
      }
      expect(generateDayRecap).not.toHaveBeenCalled()
    } finally { server.close(); await once(server, 'close') }
  })
})
