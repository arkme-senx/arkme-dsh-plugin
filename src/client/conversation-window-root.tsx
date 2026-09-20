import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import { ArkmeConversationWindow } from './ArkmeConversationWindow.js'
import { installArkmeRedesignStyles } from './redesign/styles.js'

/** Replace the default shell through the native root slot. Body portals keep
 * the same stacking and lifecycle as the main window's shared ArkmeSurface. */
export function registerConversationWindowRoot(ctx: Pick<ClientContext, 'effect' | 'slots'>): void {
  ctx.effect(installArkmeRedesignStyles, 'dsh-arkme: conversation styles')
  ctx.slots.register({ name: 'root', priority: -100 }, ArkmeConversationWindow)
}
