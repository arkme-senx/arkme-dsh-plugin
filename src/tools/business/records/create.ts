import { defineTool } from '@deepseek-ai/dsh-tools'
import { defineArkmeCoreToolModule } from '../../contract/module.js'
import { formatWriteResult, TEXT_OUTPUT } from '../../shared/output.js'
import { recordUidForToolCall } from '../../shared/stable-id.js'

export const createRecordToolModule = defineArkmeCoreToolModule({
  meta: {
    id: 'business.records.create.v1',
    toolName: 'arkme_record_create',
    kind: 'business',
    phase: 'core',
    effect: 'write',
    grant: 'explicit-user-write',
    profiles: ['business', 'hybrid'],
  },
  create(ports) {
    return defineTool({
      name: 'arkme_record_create',
      description: 'Save plain text to the signed-in user\'s Arkme default category. Call only after an explicit human request in the current conversation. The write is cached locally before remote sync.',
      parameters: {
        role_id: {type:'string',description:'Optional role ID explicitly selected by the user from arkme_self_roles_list.'},
        expected_user_id: {type:'integer',description:'Required with role_id; the currently selected account user ID.'},
        text: { type: 'string', required: true, description: 'Exact plain-text content the user explicitly asked to save to Arkme.' },
      },
      output: TEXT_OUTPUT,
      async execute(args, exec) {
        const recordUid = recordUidForToolCall(String(exec.callId))
        if (args.role_id !== undefined) {
          if (!args.expected_user_id) throw new Error('选择角色时必须提供当前账号 expected_user_id')
          const target = await ports.selfTarget()
          await ports.bindSelfRole(args.expected_user_id, target.sourceRef, recordUid, args.role_id)
        }
        const result = await ports.createTextForConversation(
          recordUid,
          args.text,
        )
        return formatWriteResult(result)
      },
    })
  },
})
