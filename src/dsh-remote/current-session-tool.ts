import { defineTool } from '@deepseek-ai/dsh-tools'
import { TEXT_OUTPUT } from '../tools/shared/output.js'
import type { DshRemoteHostFacade } from './types.js'

export function currentDesktopSessionTool(host: Pick<DshRemoteHostFacade, 'currentSession'>) {
  return defineTool({
    name: 'arkme_current_dsh_session',
    description: '读取当前桌面可见的 DSH 会话引用；桌面不在会话页面时返回空。',
    parameters: {}, output: TEXT_OUTPUT,
    isConcurrencySafe: () => true,
    execute: async () => JSON.stringify(await host.currentSession()),
  })
}
