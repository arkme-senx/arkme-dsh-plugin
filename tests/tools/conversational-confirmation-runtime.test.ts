import { Context } from '@deepseek-ai/cordis'
import { Inbox, type Agent } from '@deepseek-ai/dsh-agent'
import CodeRuntime, { type CodeRunRequest } from '@deepseek-ai/dsh-code-runtime'
import { CallId, createToolResultMessage, createUserMessage } from '@deepseek-ai/dsh-llm'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { describe, expect, it, vi } from 'vitest'
import { registerArkmeTools, type ArkmeToolPorts } from '../../src/tools/index.js'
import { preparedDirectory, directoryResult } from '../helpers/recording-directory.js'

async function fixture(code = false) {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime, code ? { mode: 'both' } : {})
  if (code) {
    class OfflineRuntime extends CodeRuntime {
      readonly language = 'typescript'
      readonly isolation = 'test'
      async run(request: CodeRunRequest) {
        try {
          const result = await request.bindings[0]!.functions.arkme_recording_import_folder!({ action: 'prepare', directory_path: '/recordings' })
          return { logs: [String(result)] }
        } catch { return { logs: ['预检失败，请重试'] } }
      }
    }
    await ctx.plugin(OfflineRuntime)
  }
  const prepare = vi.fn(async () => preparedDirectory())
  const upload = vi.fn(async () => directoryResult())
  const importFile = vi.fn(async () => ({ importRef: 'opaque-import', phase: 'prepared', revision: 1 }))
  const mount = () => ctx.plugin(Object.assign((inner: Context) => registerArkmeTools(inner, {
    prepareRecordingDirectory: prepare, importRecordingDirectory: upload, importRecordingFile: importFile,
  } as unknown as ArkmeToolPorts), { inject: ['tools', 'systemPrompt'] }))
  const mounted = await mount()
  const session = Session.create(SessionId('confirmation-runtime'))
  const inbox = new Inbox(session, { inserted() {}, discarded() {}, claimed() {} })
  const agent = { id: session.id, session, inbox } as unknown as Agent
  let count = 0
  const invoke = async (args: Record<string, unknown> = { action: 'prepare' }, name = 'arkme_recording_import_folder') => {
    const callId = CallId(`call-${++count}`)
    const input = name.endsWith('_folder') ? { directory_path: '/recordings', ...args } : args
    const call = session.append('tool/call', { turn: 1, step: count, callId, name, arguments: JSON.stringify(input) })
    const result = await ctx.tools.execute({ callId, name, arguments: input, agent, signal: new AbortController().signal })
    session.append('tool/result', { turn: 1, step: count,
      message: createToolResultMessage({ callId, content: result.content, isError: result.isError }),
    }, { surfaceOp: 'append', sourceEventSeqs: [call.seq] })
    return result
  }
  const enqueue = (text: string, kind: 'user' | 'plugin' = 'user') => inbox.append('next-step', createUserMessage({
    content: [{ type: 'text', text }], source: kind === 'user' ? { kind } : { kind, plugin: 'test' },
  }))
  const consume = () => {
    for (const message of inbox.claim('next-step', 0)) session.append('user/message', message, { surfaceOp: 'append' })
  }
  return { ctx, mounted, mount, session, agent, prepare, upload, importFile, invoke, enqueue, consume }
}

describe('conversational confirmation with durable DSH inbox events', () => {
  it.each(['invalid', 'conflict', 'time_required'] as const)('returns a read-only result without confirmation when all files are %s', async outcome => {
    const f = await fixture()
    f.prepare.mockResolvedValue({ ...preparedDirectory(), preview: [{ relativePath: 'meeting.wav', outcome }] })
    const result = await f.invoke()
    expect(result.isError).toBe(false)
    expect(JSON.stringify(result)).toContain(outcome)
    expect(JSON.stringify(result)).not.toContain('confirmation_required')
    expect(f.upload).not.toHaveBeenCalled()
  })

  it('does not grant upload when a successful run_code root caught a failed preflight sub-call', async () => {
    const f = await fixture(true)
    let reject = true
    f.ctx.on('tools/post-execute', async (exec, _result, next) => {
      if (reject && exec.name === 'arkme_recording_import_folder') { reject = false; throw new Error('preflight result rejected') }
      return await next()
    })
    expect((await f.invoke({ code: 'offline binding', description: '目录预检' }, 'run_code')).isError).toBe(false)
    const dispatch = f.session.events.find(event => event.type === 'tool/code-dispatch')
    expect(dispatch?.data.isError).toBe(true)
    f.enqueue('确认继续')
    f.consume()
    expect(JSON.stringify(await f.invoke({ action: 'upload' }))).toContain('confirmation_required')
    expect(f.upload).not.toHaveBeenCalled()
    expect(f.prepare).toHaveBeenCalledTimes(2)
  })

  it('rebinds a fresh question when the original root result was lost', async () => {
    const f = await fixture()
    const args = { action: 'upload', file_ref: 'arkme-file-v1.00000000-0000-4000-8000-000000000001', start_at_millis: 1_700_000_000_000 }
    await f.ctx.tools.execute({ callId: CallId('lost-root'), name: 'arkme_recording_import', arguments: args,
      agent: f.agent, signal: new AbortController().signal })
    f.enqueue('重新上传')
    f.consume()
    expect(JSON.stringify(await f.invoke(args, 'arkme_recording_import'))).toContain('confirmation_required')
    expect(f.importFile).not.toHaveBeenCalled()
    f.enqueue('确认新返回的问题')
    f.consume()
    await f.invoke(args, 'arkme_recording_import')
    expect(f.importFile).toHaveBeenCalledOnce()
  })

  it('starts a fresh preflight after the previous result failed to publish', async () => {
    const f = await fixture()
    let reject = true
    f.ctx.on('tools/post-execute', async (_exec, _result, next) => {
      if (reject) { reject = false; throw new Error('result publication failed') }
      return await next()
    })
    expect((await f.invoke()).isError).toBe(true)
    f.enqueue('重新上传')
    f.consume()
    expect(JSON.stringify(await f.invoke({ action: 'upload' }))).toContain('confirmation_required')
    expect(f.prepare).toHaveBeenCalledTimes(2)
    expect(f.upload).not.toHaveBeenCalled()
    f.enqueue('确认新的预检范围')
    f.consume()
    await f.invoke({ action: 'upload' })
    expect(f.upload).toHaveBeenCalledOnce()
  })

  it('allows a new human-requested operation while an earlier result awaits publication', async () => {
    const f = await fixture()
    let release!: () => void
    let finishing = false
    const gate = new Promise<void>(resolve => { release = resolve })
    f.ctx.on('tools/post-execute', async (_exec, _result, next) => {
      if (!finishing) { finishing = true; await gate }
      return await next()
    })
    const pending = f.invoke()
    await vi.waitFor(() => expect(finishing).toBe(true))
    try {
      f.enqueue('改为上传这个附件')
      f.consume()
      const args = { action: 'upload', file_ref: 'arkme-file-v1.00000000-0000-4000-8000-000000000001', start_at_millis: 1_700_000_000_000 }
      const prepared = await f.invoke(args, 'arkme_recording_import')
      expect(prepared.isError).toBe(false)
      expect(JSON.stringify(prepared)).toContain('confirmation_required')
      f.enqueue('确认这个附件')
      f.consume()
      await f.invoke(args, 'arkme_recording_import')
      expect(f.importFile).toHaveBeenCalledOnce()
    } finally { release(); await pending }
    expect(f.upload).not.toHaveBeenCalled()
  })

  it('waits for the root result of a code-mode sub-call before accepting a later confirmation', async () => {
    const f = await fixture()
    const rootCallId = CallId('run-code-root')
    f.session.append('tool/call', { turn: 1, step: 1, callId: rootCallId, name: 'run_code', arguments: '{}' })
    const input = { rootCallId, name: 'arkme_recording_import_folder',
      arguments: { action: 'upload', directory_path: '/recordings' }, agent: f.agent, signal: new AbortController().signal }
    const prepared = await f.ctx.tools.execute({ ...input, callId: CallId('root:code:1') })
    f.session.append('tool/code-dispatch', { rootCallId, parentCallId: rootCallId, subCallId: CallId('root:code:1'),
      name: input.name, arguments: input.arguments, content: prepared.content, isError: prepared.isError })
    f.enqueue('确认上传')
    f.consume()
    expect(JSON.stringify(await f.ctx.tools.execute({ ...input, callId: CallId('root:code:2') }))).toContain('confirmation_required')
    expect(f.upload).not.toHaveBeenCalled()
    f.session.append('tool/result', { turn: 1, step: 1,
      message: createToolResultMessage({ callId: rootCallId, content: prepared.content, isError: false }),
    }, { surfaceOp: 'append' })
    expect(JSON.stringify(await f.invoke({ action: 'upload' }))).toContain('confirmation_required')
    f.enqueue('确认根调用返回的范围')
    f.consume()
    await f.invoke({ action: 'upload' })
    expect(f.upload).toHaveBeenCalledOnce()
  })

  it('rejects confirmation that arrived while the prepared result was still being finalized', async () => {
    const f = await fixture()
    let release!: () => void
    let finishing = false
    const gate = new Promise<void>(resolve => { release = resolve })
    f.ctx.on('tools/post-execute', async (_exec, _result, next) => {
      if (!finishing) { finishing = true; await gate }
      return await next()
    })
    const pending = f.invoke()
    await vi.waitFor(() => expect(finishing).toBe(true))
    f.enqueue('确认上传')
    release()
    expect((await pending).isError).toBe(false)
    f.consume()
    expect(JSON.stringify(await f.invoke({ action: 'upload' }))).toContain('confirmation_required')
    expect(f.upload).not.toHaveBeenCalled()
    f.enqueue('确认刚才返回的范围')
    f.consume()
    await f.invoke({ action: 'upload' })
    expect(f.upload).toHaveBeenCalledOnce()
  })

  it('rejects a late preflight when the human steers through the inbox', async () => {
    const f = await fixture()
    let release!: () => void
    const gate = new Promise<void>(resolve => { release = resolve })
    f.prepare.mockImplementationOnce(async () => { await gate; return preparedDirectory() })
    const pending = f.invoke()
    await vi.waitFor(() => expect(f.prepare).toHaveBeenCalledOnce())
    f.enqueue('取消，改为另一个目录')
    expect(f.session.events.at(-1)?.type).toBe('agent/inbox/spliced')
    release()
    expect((await pending).isError).toBe(true)
    expect(f.upload).not.toHaveBeenCalled()
  })

  it('does not treat a previously queued confirmation as a later reply when consumed', async () => {
    const f = await fixture()
    f.enqueue('确认上传')
    expect((await f.invoke()).isError).toBe(false)
    f.consume()
    const result = await f.invoke({ action: 'upload' })
    expect(JSON.stringify(result)).toContain('confirmation_required')
    expect(f.upload).not.toHaveBeenCalled()
    f.enqueue('确认刚才核对的范围')
    f.consume()
    expect((await f.invoke({ action: 'upload' })).isError).toBe(false)
    expect(f.upload).toHaveBeenCalledOnce()
  })

  it('does not invalidate preparation or grant approval for plugin inbox messages', async () => {
    const f = await fixture()
    f.prepare.mockImplementationOnce(async () => { f.enqueue('确认', 'plugin'); return preparedDirectory() })
    expect((await f.invoke()).isError).toBe(false)
    f.consume()
    expect(JSON.stringify(await f.invoke({ action: 'upload' }))).toContain('confirmation_required')
    expect(f.upload).not.toHaveBeenCalled()
  })

  it.each([{}, { action: 'delete' }, { start_at_millis: 'yesterday' }])('keeps a confirmed single-file upload after invalid arguments: %j', async invalid => {
    const f = await fixture()
    const args = { action: 'upload', file_ref: 'arkme-file-v1.00000000-0000-4000-8000-000000000001', start_at_millis: 1_700_000_000_000 }
    await f.invoke(args, 'arkme_recording_import')
    f.enqueue('确认上传')
    f.consume()
    const { action: _, ...missingAction } = args
    const malformed = Object.keys(invalid).length === 0 ? missingAction : { ...args, ...invalid }
    expect((await f.invoke(malformed, 'arkme_recording_import')).isError).toBe(true)
    expect((await f.invoke(args, 'arkme_recording_import')).isError).toBe(false)
    expect(f.importFile).toHaveBeenCalledOnce()
  })

  it('requires fresh confirmation after re-registering the tools', async () => {
    const f = await fixture()
    await f.invoke()
    f.enqueue('确认上传')
    f.consume()
    await f.mounted.dispose()
    await f.mount()
    expect(JSON.stringify(await f.invoke({ action: 'upload' }))).toContain('confirmation_required')
    expect(f.upload).not.toHaveBeenCalled()
  })
})
