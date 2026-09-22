import { defineTool } from '@deepseek-ai/dsh-tools'
import { defineArkmeCoreToolModule } from '../../contract/module.js'
import { TEXT_OUTPUT } from '../../shared/output.js'
export const socialAccessToolModule = defineArkmeCoreToolModule({
 meta: { id: 'business.account.social-access.v1', toolName: 'arkme_social_access', kind: 'business', phase: 'core', effect: 'read', profiles: ['business', 'hybrid'] },
 create(ports) { return defineTool({
  name: 'arkme_social_access', description: 'Check whether the signed-in Arkme account can use chats, contacts, world and interpersonal calls. This does not change login or phone binding.',
  parameters: {}, output: TEXT_OUTPUT, isConcurrencySafe: () => true,
  async execute() { return JSON.stringify(await ports.socialAccessStatus()) },
 }) },
})
