import { describe, expect, it, vi } from 'vitest'
import type { ToolDispatchExecution, ToolExecutionResult } from '@deepseek-ai/dsh-tools'
import { ManagedOpenApiMcpExecutionSupersededError } from '../src/openapi-mcp/controller.js'
import { registerManagedOpenApiMcpExecutionFence } from '../src/openapi-mcp/execution-fence.js'

function success(): ToolExecutionResult {
  return { isError: false, value: null, content: [] }
}

describe('managed OpenAPI MCP DSH execution fence adapter', () => {
  it('passes the lifecycle signal only for delegated execution and restores the caller signal', async () => {
    let listener: ((execution: ToolDispatchExecution, next: () => Promise<ToolExecutionResult>) => Promise<ToolExecutionResult>) | undefined
    const off = vi.fn(() => true)
    const ctx = { on: vi.fn((_event, value) => { listener = value; return off }) }
    const lifecycle = new AbortController()
    const controller = {
      executeManagedTool: vi.fn(async (_name, _signal, execute) => await execute(lifecycle.signal)),
    }
    registerManagedOpenApiMcpExecutionFence(ctx as never, controller as never)
    const caller = new AbortController()
    const execution = { name: 'mcp__arkme__profile_get', signal: caller.signal } as ToolDispatchExecution

    const result = await listener?.(execution, async () => {
      expect(execution.signal).toBe(lifecycle.signal)
      return success()
    })

    expect(result).toEqual(success())
    expect(execution.signal).toBe(caller.signal)
  })

  it('replaces a superseded result with one credential-free structured failure', async () => {
    let listener: ((execution: ToolDispatchExecution, next: () => Promise<ToolExecutionResult>) => Promise<ToolExecutionResult>) | undefined
    const ctx = { on: vi.fn((_event, value) => { listener = value; return () => true }) }
    const controller = {
      executeManagedTool: vi.fn(async () => { throw new ManagedOpenApiMcpExecutionSupersededError() }),
    }
    registerManagedOpenApiMcpExecutionFence(ctx as never, controller as never)

    const result = await listener?.(
      { name: 'mcp__arkme__profile_get', signal: new AbortController().signal } as ToolDispatchExecution,
      async () => success(),
    )

    expect(result).toMatchObject({
      isError: true,
      error: { info: { code: 'ARKME_MCP_LIFECYCLE_CHANGED' } },
    })
    expect(JSON.stringify(result)).not.toContain('arkme_')
  })
})
