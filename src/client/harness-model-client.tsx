import type { ClientContext, SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import type { ComponentProps } from 'react'
import { ArkmeModelSelect, type ArkmeModelDirectory } from './ArkmeModelSelect.js'

// The public conversation.input.model slot is present on supported DSH model-selection runtimes.
declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    'conversation.input.model': { kind: 'single'; scope: 'session'; owner: { locked: boolean } }
  }
}

function ModelSeat({ sessionId, ...props }: ComponentProps<typeof ArkmeModelSelect> & { sessionId: SessionId }) {
  return <ArkmeModelSelect key={sessionId} {...props} />
}

export const inject = ['slots', 'sessions']

export function apply(ctx: ClientContext): void {
  ctx.inject(['modelDirectories'], scope => {
    const models = scope.get('modelDirectories') as {
      directoryFor(sessionId: SessionId): ArkmeModelDirectory
    } | undefined
    const sessions = scope.sessions as unknown as { subagentAddress?: (sessionId: SessionId) => unknown }
    if (typeof models?.directoryFor !== 'function' || typeof sessions.subagentAddress !== 'function') return
    scope.slots.inject('conversation.input.model', () => scope.slots.register({
      name: 'conversation.input.model',
      priority: -100,
      inject: sessionId => ({
        directory: models.directoryFor(sessionId),
        available: sessions.subagentAddress!(sessionId) === undefined,
      }),
    }, ModelSeat))
  })
}
