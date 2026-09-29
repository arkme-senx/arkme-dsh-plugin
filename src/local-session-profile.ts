import type { Context } from '@deepseek-ai/cordis'
import LocalSessionRegistry from './local-session-registry.js'
import LocalSessionGateway from './local-session-gateway.js'
import LocalSessionRuntime from './local-session-runtime.js'

/** One host-only Loader entry owns the complete opt-in session adapter. */
export function apply(ctx: Context, config: ConstructorParameters<typeof LocalSessionRuntime>[1]): void {
  ctx.plugin(LocalSessionRegistry)
  ctx.plugin(LocalSessionGateway, {})
  ctx.plugin(LocalSessionRuntime, config)
}
