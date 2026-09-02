import type { Context } from '@deepseek-ai/cordis'
import type { ToolExecutionResult } from '@deepseek-ai/dsh-tools'
import {
  ManagedOpenApiMcpController,
  ManagedOpenApiMcpExecutionSupersededError,
} from './controller.js'

/** Binds the controller's account fence to DSH's public around-dispatch seam. */
export function registerManagedOpenApiMcpExecutionFence(
  ctx: Context,
  controller: ManagedOpenApiMcpController,
): () => boolean {
  return ctx.on('tools/execute', async (execution, next): Promise<ToolExecutionResult> => {
    const upstream = execution.signal
    try {
      return await controller.executeManagedTool(
        execution.name,
        upstream,
        async signal => {
          execution.signal = signal
          try { return await next() } finally { execution.signal = upstream }
        },
      )
    } catch (error) {
      if (!(error instanceof ManagedOpenApiMcpExecutionSupersededError)) throw error
      return supersededResult(error)
    }
  })
}

function supersededResult(error: ManagedOpenApiMcpExecutionSupersededError): ToolExecutionResult {
  return {
    isError: true,
    content: [{ type: 'text', text: `Error: ${error.message}` }],
    error: {
      message: error.message,
      info: { name: error.name, code: 'ARKME_MCP_LIFECYCLE_CHANGED' },
    },
  }
}
