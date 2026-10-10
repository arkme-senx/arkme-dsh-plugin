import type {} from '@deepseek-ai/dsh-client-ui-slots'

/** Public native slot consumed by Arkme's independent header contributions. */
declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    'conversation.session.header.actions': { kind: 'list'; scope: 'session'; owner: Record<never, never> }
  }
}
