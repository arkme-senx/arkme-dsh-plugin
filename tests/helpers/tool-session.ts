import type { Context } from '@deepseek-ai/cordis'
import { CallId, createToolResultMessage } from '@deepseek-ai/dsh-llm'
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import { vi } from 'vitest'

/** Append-only session fixtures use the same increasing sequence as Session.append. */
export function sessionEvents(initial: Array<Record<string, unknown>> = []): Array<Record<string, unknown>> {
  const events: Array<Record<string, unknown>> = []
  Object.defineProperty(events, 'push', { value: (...items: Array<Record<string, unknown>>) => {
    for (const item of items) Array.prototype.push.call(events, { ...item, seq: events.length })
    return events.length
  } })
  events.push(...initial)
  return events
}

export function appendToolResult(events: Array<Record<string, unknown>>, callId: string, value: unknown): void {
  events.push({ seq: events.length, type: 'tool/result', data: { turn: 1, step: 1,
    message: createToolResultMessage({ callId: CallId(callId), content: [{ type: 'text', text: JSON.stringify(value) }], isError: false }),
  } })
}

/** ToolRuntime does not own the Agent loop's durable tool-result publication. */
export function recordToolResults(ctx: Context): void {
  const execute = ctx.tools.execute.bind(ctx.tools)
  vi.spyOn(ctx.tools, 'execute').mockImplementation(async input => {
    const result = await execute(input)
    if (input.agent?.session !== undefined) {
      const events = input.agent.session.events as unknown as Array<Record<string, unknown>>
      events.push({ seq: events.length, type: 'tool/result', data: { turn: 1, step: 1,
        message: createToolResultMessage({ callId: input.rootCallId ?? input.callId, content: result.content, isError: result.isError }),
      } })
    }
    return result
  })
}

export function recordDefinitionResults<T extends ToolDefinition>(definition: T): T {
  return { ...definition, async execute(args, exec) {
    const result = await definition.execute(args, { ...exec, rootCallId: exec.rootCallId ?? exec.callId })
    if (exec.agent?.session !== undefined) {
      appendToolResult(exec.agent.session.events as unknown as Array<Record<string, unknown>>, exec.rootCallId ?? exec.callId, result)
    }
    return result
  } }
}
