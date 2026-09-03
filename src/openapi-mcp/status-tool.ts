import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { TEXT_OUTPUT } from '../tools/shared/output.js'
import type { ManagedOpenApiMcpController } from './controller.js'
import type { OpenApiMcpStatus } from './types.js'

function modelSafeStatus(status: OpenApiMcpStatus): string {
  return JSON.stringify({
    state: status.state,
    retryable: status.retryable,
    userAction: status.userAction,
  })
}

export function registerOpenApiMcpLifecycleTools(
  ctx: Context,
  controller: Pick<ManagedOpenApiMcpController, 'status' | 'retry'>,
): void {
  ctx.tools.register(defineTool({
    name: 'arkme_openapi_mcp_status',
    description: 'Report the managed Arkme OpenAPI MCP connection for the current account. state is inactive, reconciling, ready, or degraded; ready means the current mcp__arkme__* tools are mounted and executable. userAction is none or login. Returns no credentials or account identifiers.',
    parameters: {},
    output: TEXT_OUTPUT,
    isConcurrencySafe: () => true,
    execute() { return Promise.resolve(modelSafeStatus(controller.status())) },
  }))
  ctx.tools.register(defineTool({
    name: 'arkme_openapi_mcp_retry',
    description: 'Retry the managed Arkme OpenAPI MCP connection when state is degraded and retryable is true. userAction is none or login. Returns no credentials, account identifiers, or scheduler details.',
    parameters: {},
    output: TEXT_OUTPUT,
    execute() { return controller.retry().then(modelSafeStatus) },
  }))
}
