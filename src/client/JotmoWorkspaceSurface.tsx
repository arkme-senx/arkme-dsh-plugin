import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import { JotmoNavigation } from './JotmoVirtualWorkspace.js'

export type JotmoWorkspaceSurfaceProps = PropsRuntime<'sidebar.workspaces'>

/** Official sidebar browsing-region replacement shown only while Jiwo is open. */
export function JotmoWorkspaceSurface({ wide }: JotmoWorkspaceSurfaceProps) {
  return wide ? <JotmoNavigation /> : null
}
