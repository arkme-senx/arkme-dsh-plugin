import { SessionId } from '@deepseek-ai/dsh-session'
import type LocalSessionRegistry from './local-session-registry.js'
import { TypertGatewayService } from '@deepseek-ai/dsh-api-gateway'
import type { InvokeRemoteRequest } from '@deepseek-ai/dsh-api-gateway/types'
import type LocalSessionRuntime from './local-session-runtime.js'

/** Public Profile replacement, keeping the upstream dispatcher and codecs. */
export default class LocalSessionGateway extends TypertGatewayService {
  static inject = ['typert', 'agents']
  override registerRemoteEvents(...[source, host]: Parameters<TypertGatewayService['registerRemoteEvents']>): ReturnType<TypertGatewayService['registerRemoteEvents']> {
    const registry = this.ctx.agents as LocalSessionRegistry
    return super.registerRemoteEvents(signal => (async function* () {
      for await (const event of source(signal)) {
        if (!('context' in event) && event.event === 'api-session/removed'
          && typeof event.args[0] === 'string' && registry.retainsSession(SessionId(event.args[0]))) continue
        yield event
      }
    })(), host)
  }

  override async invoke(request: InvokeRemoteRequest): Promise<unknown> {
    const local = this.ctx.get('arkmeLocalSessions') as LocalSessionRuntime | undefined
    if (!local) throw new Error('本机会话服务尚未就绪')
    const result = await local.invoke(request, () => super.invoke(request))
    // Upstream emits session/created before workspace.attachSession commits.
    // Refresh our account catalog only after the full native create succeeds.
    if (request.namespace === 'session' && request.method === 'create'
      && result && typeof result === 'object' && 'sessionId' in result && typeof result.sessionId === 'string') {
      this.ctx.emit('arkme/session-created', result.sessionId)
    }
    return result
  }

  override async stream(request: InvokeRemoteRequest): Promise<AsyncIterable<unknown>> {
    const local = this.ctx.get('arkmeLocalSessions') as LocalSessionRuntime | undefined
    if (!local) throw new Error('本机会话服务尚未就绪')
    return local.stream(request, (current = request) => super.stream(current))
  }
}

declare module '@deepseek-ai/cordis' {
  interface Events { 'arkme/session-created'(sessionId: string): void }
}
