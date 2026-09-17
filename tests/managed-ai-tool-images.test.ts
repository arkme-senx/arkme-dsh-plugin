import { AttachmentError, AttachmentId } from '@deepseek-ai/dsh-attachment'
import { CallId, createAssistantMessage, createMessage, createUserMessage, LlmError } from '@deepseek-ai/dsh-llm'
import type { ContentBlock, GenerateOptions, Message } from '@deepseek-ai/dsh-llm'
import sharp from 'sharp'
import { describe, expect, it, vi } from 'vitest'
import { localizeManagedAiError } from '../src/managed-ai/adapter.js'
import { ManagedAiTransport, type ManagedImageCapability, type ManagedModelCapability } from '../src/managed-ai/transport.js'

const text = (value: string): ContentBlock => ({ type: 'text', text: value })
const user = (content: ContentBlock[]) => createUserMessage({ content, source: { kind: 'user' } })
const result = (id: string, content: ContentBlock[]): ContentBlock => ({ type: 'tool-result', toolCallId: CallId(id), content })
const assistant = (ids: string[]) => createAssistantMessage({
  content: [{ type: 'reasoning', text: 'inspect images' }, ...ids.map(id => ({ type: 'tool-call' as const, id: CallId(id), name: 'read_image', arguments: '{}' }))],
  source: { kind: 'model', provider: 'arkme-managed', model: 'vision' },
})
type Part = { type: string; text?: string; asset_ref?: string }
type WireMessage = { role: string; content: string | Part[]; tool_call_id?: string }

async function fixture(overrides: Partial<ManagedImageCapability> = {}) {
  const data = await sharp({ create: { width: 16, height: 16, channels: 3, background: '#46a8d4' } }).png().toBuffer()
  const ref = { attachmentId: AttachmentId('test-image'), mediaType: 'image/png' as const, bytes: data.length, width: 16, height: 16 }
  const image: ContentBlock = { type: 'image', attachment: ref }
  const capability: ManagedModelCapability = {
    contractVersion: 'tool-image-test-v1', inputModalities: ['text', 'image'], outputModalities: ['text'],
    image: { allowedMediaTypes: ['image/png'], maximumImages: 10, maximumBytesPerImage: 1024,
      countDimensionLimits: [], mediaTypeDimensionLimits: [], ...overrides },
  }
  const bodies: Array<{ messages: WireMessage[] }> = []
  const declarations: Array<{ asset: { width: number; height: number; size_bytes: number } }> = []
  const readImage = vi.fn(async (attachment: typeof ref, _signal?: AbortSignal) => ({ ref: attachment, data }))
  const resolveBearer = vi.fn(async () => 'fixture-bearer')
  let refreshes = 0
  const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input)
    if (url.endsWith('/input-assets/uploads/prepare')) {
      declarations.push(JSON.parse(String(init?.body)))
      return Response.json({ code: 200, data: {
        upload_uid: `upload_${declarations.length}`, asset_ref: `mai_asset_${declarations.length}`, status: 'completed',
        expires_at: Date.now() + 600_000, asset_expires_at: Date.now() + 600_000,
      } })
    }
    if (url.endsWith('/chat/completions')) {
      bodies.push(JSON.parse(String(init?.body)))
      if (refreshes > 0) {
        refreshes--
        return Response.json({ error: { code: 'input_asset_refresh_required' } }, { status: 400 })
      }
      return new Response('data: {"choices":[{"delta":{"content":"ok"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n')
    }
    throw new Error(`Unexpected fixture request ${url}`)
  })
  const transport = new ManagedAiTransport({ baseUrl: 'https://fixture.invalid/api/v1/managed-ai',
    resolveAttachmentReader: () => ({ readImage }), resolveBearer, fetchImpl,
    resolveAnonymousUserId: () => '11111111-1111-4111-8111-111111111111' as never,
  })
  return { image, ref, capability, bodies, declarations, readImage, fetchImpl, resolveBearer,
    refresh: (count: number) => { refreshes = count },
    run: async (messages: Message[], selected = capability, options: Pick<GenerateOptions, 'signal' | 'purpose'> = {}) => {
      const chunks = []
      for await (const chunk of transport.stream({ provider: 'arkme-managed', model: 'vision', messages, ...options }, selected)) chunks.push(chunk)
      return chunks
    },
  }
}

function images(messages: WireMessage[]): Part[] {
  return messages.flatMap(message => Array.isArray(message.content) ? message.content.filter(part => part.type === 'image_asset') : [])
}

describe('managed tool-result images', () => {
  it('keeps the whole parallel tool group together, correlates images, and preserves durable history', async () => {
    const f = await fixture()
    const second: ContentBlock = { type: 'image', attachment: { ...f.ref, attachmentId: AttachmentId('second-image') } }
    const messages = [assistant(['first', 'second', 'text-only']),
      user([result('first', [text('before'), f.image, text('after')])]),
      user([result('second', [second])]), user([result('text-only', [text('done')])]),
      user([text('continue')])]
    const original = JSON.stringify(messages)
    await f.run(messages)
    const wire = f.bodies[0]!.messages
    expect(wire.map(message => message.role)).toEqual(['assistant', 'tool', 'tool', 'tool', 'user', 'user'])
    expect(wire.slice(1, 4)).toEqual([
      { role: 'tool', tool_call_id: 'first', content: 'beforeafter' },
      { role: 'tool', tool_call_id: 'second', content: '(no output)' },
      { role: 'tool', tool_call_id: 'text-only', content: 'done' },
    ])
    expect(wire[4]!.content).toEqual([
      { type: 'text', text: 'Images from tool call first:' }, { type: 'image_asset', asset_ref: 'mai_asset_1' },
      { type: 'text', text: 'Images from tool call second:' }, { type: 'image_asset', asset_ref: 'mai_asset_2' },
    ])
    expect(wire[0]).toMatchObject({ reasoning_content: 'inspect images' })
    expect(JSON.stringify(messages)).toBe(original)
    await f.run(messages)
    expect(f.bodies[1]).toEqual(f.bodies[0])
    expect(f.readImage).toHaveBeenCalledTimes(2)
  })

  it('flattens nested tool content under the outer call without losing text, images or empty results', async () => {
    const f = await fixture()
    await f.run([assistant(['outer', 'empty']), user([
      result('outer', [text('a'), result('inner', [text('b'), f.image]), text('c')]), result('empty', []),
    ])])
    expect(f.bodies[0]!.messages.slice(1, 3)).toEqual([
      { role: 'tool', tool_call_id: 'outer', content: 'abc' },
      { role: 'tool', tool_call_id: 'empty', content: '(no output)' },
    ])
    expect(images(f.bodies[0]!.messages)).toHaveLength(1)
    expect(JSON.stringify(f.bodies[0])).not.toContain('inner')
  })

  it.each(['end', 'system', 'assistant', 'user'] as const)('flushes images at the %s boundary', async boundary => {
    const f = await fixture()
    const next = boundary === 'system' ? [createMessage({ role: 'system', content: [text('system')], source: { kind: 'plugin', plugin: 'test' } })]
      : boundary === 'assistant' ? [assistant([])] : boundary === 'user' ? [user([text('next')])] : []
    await f.run([assistant(['a']), user([result('a', [f.image])]), ...next])
    expect(f.bodies[0]!.messages.map(message => message.role)).toEqual(['assistant', 'tool', 'user', ...next.map(message => message.role)])
  })

  it('retains all repeated image positions across direct input and tool results while sharing the upload', async () => {
    const f = await fixture()
    await f.run([user([text('direct'), f.image]), assistant(['a']), user([result('a', [f.image, f.image])])])
    expect(images(f.bodies[0]!.messages)).toEqual(Array.from({ length: 3 }, () => ({ type: 'image_asset', asset_ref: 'mai_asset_1' })))
    expect(f.declarations).toHaveLength(1)
    expect(f.readImage).toHaveBeenCalledTimes(1)
  })

  it('counts every image occurrence before any upload, including repeated nested images', async () => {
    const f = await fixture({ maximumImages: 2 })
    await expect(f.run([user([f.image, result('a', [result('inner', [f.image, f.image])])])])).rejects.toMatchObject({ code: 'INVALID_REQUEST' })
    expect(f.readImage).not.toHaveBeenCalled()
    expect(f.fetchImpl).not.toHaveBeenCalled()
    expect(f.resolveBearer).not.toHaveBeenCalled()
  })

  it('applies count-dependent dimensions to tool images and counts bytes per occurrence', async () => {
    const f = await fixture({ countDimensionLimits: [{ minimumImages: 2, maximumWidth: 8, maximumHeight: 8 }] })
    await f.run([user([result('a', [f.image, f.image])])])
    expect(f.declarations[0]!.asset).toMatchObject({ width: 8, height: 8 })
    const limited = await fixture({ maximumTotalBytes: f.ref.bytes })
    await expect(limited.run([user([result('a', [limited.image, limited.image])])])).rejects.toMatchObject({ code: 'INVALID_REQUEST' })
    expect(limited.bodies).toHaveLength(0)
  })

  it('refreshes expired tool image handles once and keeps every repeated occurrence', async () => {
    const f = await fixture()
    f.refresh(1)
    await f.run([user([result('a', [f.image, f.image])])])
    expect(f.bodies.map(body => images(body.messages).map(part => part.asset_ref))).toEqual([
      ['mai_asset_1', 'mai_asset_1'], ['mai_asset_2', 'mai_asset_2'],
    ])
    expect(f.readImage).toHaveBeenCalledTimes(2)
    f.refresh(2)
    await expect(f.run([user([result('a', [f.image])])])).rejects.toMatchObject({ code: 'INVALID_REQUEST' })
    expect(f.bodies).toHaveLength(4)
  })

  it('rejects tool images on a text-only transport before attachment or network access', async () => {
    const f = await fixture()
    await expect(f.run([user([result('a', [f.image])])], {
      contractVersion: 'text-chat-v1', inputModalities: ['text'], outputModalities: ['text'],
    })).rejects.toMatchObject({ code: 'UNSUPPORTED_CONTENT' })
    expect(f.readImage).not.toHaveBeenCalled()
    expect(f.fetchImpl).not.toHaveBeenCalled()
  })

  it('rejects unsupported nested blocks before uploading an earlier valid image', async () => {
    const f = await fixture()
    await expect(f.run([user([f.image]), user([result('a', [result('inner', [{ type: 'reasoning', text: 'invalid' }])])])]))
      .rejects.toMatchObject({ code: 'UNSUPPORTED_CONTENT' })
    expect(f.readImage).not.toHaveBeenCalled()
    expect(f.fetchImpl).not.toHaveBeenCalled()
  })

  it.each(['system', 'assistant'] as const)('keeps the %s image boundary before all uploads', async role => {
    const f = await fixture()
    const unsupported = createMessage({ role, content: [f.image], source: { kind: 'plugin', plugin: 'test' } })
    await expect(f.run([user([result('a', [f.image])]), unsupported])).rejects.toMatchObject({ code: 'UNSUPPORTED_CONTENT' })
    expect(f.readImage).not.toHaveBeenCalled()
    expect(f.fetchImpl).not.toHaveBeenCalled()
    expect(f.resolveBearer).not.toHaveBeenCalled()
  })

  it('does not reuse a tool image handle after the account credential changes', async () => {
    const f = await fixture()
    const messages = [user([result('a', [f.image])])]
    await f.run(messages)
    f.resolveBearer.mockResolvedValue('another-fixture-account')
    await f.run(messages)
    expect(f.bodies.map(body => images(body.messages)[0]!.asset_ref)).toEqual(['mai_asset_1', 'mai_asset_2'])
    expect(f.readImage).toHaveBeenCalledTimes(2)
  })

  it('keeps ordinary text/tool wire messages unchanged', async () => {
    const f = await fixture()
    await f.run([user([text('hello')]), assistant(['a']), user([result('a', [text('ok')])])])
    expect(f.bodies[0]!.messages.map(message => message.role)).toEqual(['user', 'assistant', 'tool'])
    expect(f.readImage).not.toHaveBeenCalled()
    expect(f.declarations).toHaveLength(0)
  })

  it('preserves nested tool text on a text-only model', async () => {
    const f = await fixture()
    await f.run([user([result('outer', [text('a'), result('inner', [text('b')]), text('c')])])], {
      contractVersion: 'text-chat-v1', inputModalities: ['text'], outputModalities: ['text'],
    })
    expect(f.bodies[0]!.messages).toEqual([{ role: 'tool', tool_call_id: 'outer', content: 'abc' }])
    expect(f.readImage).not.toHaveBeenCalled()
  })

  it('preserves tool images when the request compacts history', async () => {
    const f = await fixture()
    await f.run([assistant(['a']), user([result('a', [f.image])])], f.capability, { purpose: 'compaction' })
    expect(images(f.bodies[0]!.messages)).toHaveLength(1)
    const chat = f.fetchImpl.mock.calls.find(([input]) => String(input).endsWith('/chat/completions'))
    expect(chat?.[1]?.headers).toMatchObject({ 'X-DeepSeek-Harness-Compact': '1' })
  })

  it('reports unavailable historical tool images without a model request', async () => {
    const f = await fixture()
    f.readImage.mockRejectedValue(new AttachmentError('missing', 'ATTACHMENT_NOT_FOUND'))
    await expect(f.run([user([result('a', [f.image])])])).rejects.toMatchObject({ code: 'ATTACHMENT_UNAVAILABLE' })
    expect(f.fetchImpl).not.toHaveBeenCalled()
  })

  it('cancels a tool image read and permits a clean resend', async () => {
    const f = await fixture()
    const controller = new AbortController()
    let started!: () => void
    const reading = new Promise<void>(resolve => { started = resolve })
    f.readImage.mockImplementationOnce(async (_ref, signal) => {
      started()
      return await new Promise<never>((_resolve, reject) => {
        signal!.addEventListener('abort', () => reject(signal!.reason), { once: true })
      })
    })
    const messages = [user([result('a', [f.image])])]
    const attempt = f.run(messages, f.capability, { signal: controller.signal })
    const rejected = expect(attempt).rejects.toMatchObject({ code: 'ABORTED' })
    await reading
    controller.abort()
    await rejected
    expect(f.fetchImpl).not.toHaveBeenCalled()
    await f.run(messages)
    expect(images(f.bodies[0]!.messages)).toHaveLength(1)
  })

  it('gives unsupported content actionable copy without leaking the original error', () => {
    expect(localizeManagedAiError(new LlmError('private path or provider payload', 'UNSUPPORTED_CONTENT'))).toMatchObject({
      code: 'UNSUPPORTED_CONTENT', message: '当前模型或图片服务不支持这类内容，请检查模型选择和附件后重试',
    })
  })
})
