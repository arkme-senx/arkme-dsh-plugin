import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { TEXT_OUTPUT } from '../tools/shared/output.js'
import type { ManagedOpenApiMcpController } from './controller.js'

export function registerOpenApiMcpStatusTool(ctx: Context, controller: Pick<ManagedOpenApiMcpController, 'status'>): void {
  ctx.tools.register(defineTool({
    name: 'arkme_openapi_mcp_status',
    description: 'Check whether managed OpenAPI MCP tools are available for the current Arkme account and whether login or reauthorization is required.',
    parameters: {},
    output: TEXT_OUTPUT,
    isConcurrencySafe: () => true,
    execute() { return Promise.resolve(JSON.stringify(controller.status())) },
  }))
}
