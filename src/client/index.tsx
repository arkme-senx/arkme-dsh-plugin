import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'
import type { MainSurfaceOwnerProps } from '@deepseek-ai/dsh-client-ui-layout/client'
import { JotmoSettingsRow } from './JotmoSettingsRow.js'
import { JotmoSurface } from './JotmoSidebar.js'
import {
  JOTMO_SURFACE_ID, JotmoVirtualWorkspace, type JotmoVirtualWorkspaceInjected,
} from './JotmoVirtualWorkspace.js'

export const inject = ['slots', 'layout']

export function apply(ctx: ClientContext): void {
  ctx.slots.inject('sidebar.workspaces.virtual', () => ctx.slots.register({
    name: 'sidebar.workspaces.virtual',
    id: 'jotmo',
    order: 10,
    inject: (): JotmoVirtualWorkspaceInjected => ({
      hooks: { surface: ctx.layout.surface },
      open: () => { ctx.layout.showSurface(JOTMO_SURFACE_ID) },
    }),
  }, JotmoVirtualWorkspace))

  ctx.slots.inject('main.surface', () => ctx.slots.register({
    name: 'main.surface',
    priority: 10,
    select: (owner: MainSurfaceOwnerProps) => owner.surface === JOTMO_SURFACE_ID
      ? JOTMO_SURFACE_ID
      : null,
  }, JotmoSurface))

  ctx.slots.inject('settings.general.item', () => ctx.slots.register({
    name: 'settings.general.item',
    id: 'jotmo-account',
    order: 80,
  }, JotmoSettingsRow))
}

export { JotmoSettingsRow } from './JotmoSettingsRow.js'
export { JotmoSurface } from './JotmoSidebar.js'
export { JOTMO_SURFACE_ID, JotmoVirtualWorkspace } from './JotmoVirtualWorkspace.js'
