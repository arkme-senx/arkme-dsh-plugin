import { Context } from '@deepseek-ai/cordis'
import { SessionController, type SessionControlFrame } from '@deepseek-ai/dsh-api-session-controller'
import { TypertRegistry } from '@deepseek-ai/dsh-typert-registry'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import { ToolCallId, createToolResultMessage } from '@deepseek-ai/dsh-llm'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime, { defineTool } from '@deepseek-ai/dsh-tools'
import { PtcRuntime, type PtcRunRequest, type PtcRunResult, type PtcRunSpec } from '@deepseek-ai/dsh-ptc-runtime'

/** The published Controller owns frame serialization; only its domain data is supplied. */
export async function publishedControlBaseline(values: Record<string, { asOfSeq: number; values: Record<string, unknown> }>): Promise<SessionControlFrame> {
  const ctx = new Context()
  new TypertRegistry(ctx)
  for (const [name, value] of Object.entries({
    sessions: { list: () => Object.keys(values).map(id => ({ id })) },
    sessionProjections: { register: () => () => {}, onChanged: () => () => {}, snapshot: (session: { id: string }) => values[session.id] },
    fileUploads: { registerAgentResolver: () => () => {} }, attachments: { limits: {} },
    remoteAccess: { allows: () => true }, agents: {}, workspaceRegistry: {}, agentDefaultModel: {}, sessionQuery: {}, fs: {}, llm: {},
  })) ctx.reflect.provide(name, value)
  const controller = new SessionController(ctx, {})
  const abort = new AbortController()
  const stream = controller.control(abort.signal)[Symbol.asyncIterator]()
  try { return (await stream.next()).value! }
  finally { abort.abort(); await stream.return?.(); await ctx.fiber.dispose() }
}

/** No model, shell or filesystem tool runs: the official Tools pipeline emits the journal. */
class BindingRuntime extends PtcRuntime {
  readonly language = 'typescript'
  readonly isolation = 'test'
  resolve(request: PtcRunRequest): PtcRunSpec { return { ...request, cwd: process.cwd(), timeoutMs: 1000 } }
  async run(request: PtcRunRequest): Promise<PtcRunResult> {
    return { logs: [], value: await request.bindings[0]!.functions.protocol_echo!({ value: 'DSH protocol fixture' }) }
  }
}

export async function publishedPtcHistory() {
  const ctx = new Context()
  ctx.reflect.provide('workingDirectory', { get: () => process.cwd(), ensure: async () => process.cwd() })
  try {
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime, { mode: 'ptc' })
    await ctx.plugin(BindingRuntime)
    ctx.tools.register(defineTool({
      name: 'protocol_echo', description: 'Protocol fixture echo.', parameters: { value: { type: 'string', required: true } },
      output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
      execute: async args => args.value,
    }))
    const session = Session.create(SessionId('protocol-fixture'))
    session.append('tool/call', { turn: 1, step: 1, callId: ToolCallId('root'), name: 'run_code', arguments: '{}' })
    const agent = { ctx, id: session.id, session } as Parameters<typeof ctx.tools.execute>[0]['agent']
    const result = await ctx.tools.execute({ callId: ToolCallId('root'), name: 'run_code', arguments: { code: 'return await tools.protocol_echo({ value: "DSH protocol fixture" })', description: 'Protocol fixture' }, signal: new AbortController().signal, agent })
    if (result.isError) throw new Error(JSON.stringify(result))
    session.append('tool/result', { turn: 1, step: 1, message: createToolResultMessage({ callId: ToolCallId('root'), content: result.content, isError: result.isError }) }, { surfaceOp: 'append', sourceEventSeqs: [0] })
    // Keep protocol fields intact; stabilize only time and the opaque result message id.
    return session.snapshotEvents().map(event => ({ event: { ...event, time: 1000 + event.seq, ...(event.type === 'tool/result' ? { data: { ...event.data, message: { ...event.data.message, id: 'protocol-result' } } } : {}) } }))
  } finally { await ctx.fiber.dispose() }
}
