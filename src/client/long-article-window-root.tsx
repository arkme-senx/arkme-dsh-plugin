import type { Context as ClientContext } from '@deepseek-ai/cordis'
import { ArkmeLongArticleWindow } from './ArkmeLongArticleWindow.js'
import { installArkmeRedesignStyles } from './redesign/styles.js'

/** Replace the Harness shell so body portals remain in the native root's stacking
 * context. An elevated body sibling would cover the location/library portals and
 * silently intercept their mouse input, even though the sibling is transparent. */
export function registerLongArticleWindowRoot(ctx: Pick<ClientContext, 'effect' | 'slots'>): void {
  ctx.effect(installArkmeRedesignStyles, 'dsh-arkme: article and browse styles')
  ctx.slots.register({ name: 'root', priority: -100 }, ArkmeLongArticleWindow)
}
