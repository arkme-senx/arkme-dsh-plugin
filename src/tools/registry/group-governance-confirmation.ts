import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { ToolArgsError, validateJsonSchemaValue, type ToolExecutionResult } from '@deepseek-ai/dsh-tools'
import { ArkmeConversationalConfirmation } from '../shared/conversational-confirmation.js'

const WITHDRAW = 'mcp__arkme__withdraw_group_messages'
const REMOVE = 'mcp__arkme__remove_group_members'
const RESTRICT = 'mcp__arkme__set_group_join_restrictions'
const writes = new Set([WITHDRAW, REMOVE, RESTRICT])

export interface GroupGovernancePresentation {
  currentAccount(): Promise<number | undefined>
  withGroupMemberInvalidation<T>(groups: string[], execute: () => Promise<T>): Promise<T>
}

/** Keep the existing conversational safeguard around official MCP dispatch, without copying tools. */
export function registerGroupGovernanceConfirmation(ctx: Context, conversation: ArkmeConversationalConfirmation, presentation?: GroupGovernancePresentation): void {
  ctx.on('tools/execute', async (execution, next): Promise<ToolExecutionResult> => {
    if (!writes.has(execution.name)) return await next()
    const definition = ctx.tools.get(execution.name)
    if (definition === undefined) return await next()
    const violations = validateJsonSchemaValue(definition.parameters, execution.arguments, '')
    if (violations.length > 0) throw new ToolArgsError(violations)
    if (execution.agent === undefined) throw new Error('群治理操作必须在一个真实 DSH Agent 会话中确认')
    const account = await presentation?.currentAccount()
    if (presentation !== undefined && account === undefined) throw new Error('群治理操作需要当前登录账号')
    const result = await conversation.prepareOrExecute({
      agent: execution.agent as Agent,
      callId: execution.callId, rootCallId: execution.rootCallId,
      operationKey: execution.name, arguments: { account, input: execution.arguments },
      question: groupGovernanceQuestion(execution.name, execution.arguments),
      execute: () => execution.name === REMOVE && presentation !== undefined
        ? presentation.withGroupMemberInvalidation([...new Set((execution.arguments as { items: { chat_session_uid: string }[] }).items.map(item => item.chat_session_uid))], next)
        : next(),
    })
    if ('isError' in result) return result
    const text = JSON.stringify(result)
    // This is a local non-execution, not an owner result. MCP success values
    // must keep the server's output schema; never forge a successful empty batch.
    return { isError: true, content: [{ type: 'text', text }], error: { message: result.question, info: { name: 'ArkmeConfirmationRequired', code: 'ARKME_CONFIRMATION_REQUIRED' } } }
  })
}

function groupGovernanceQuestion(name: string, args: unknown): string {
  const items = (args as { items: Record<string, unknown>[] }).items
  if (name === WITHDRAW) return `是否确认撤回已选定的 ${items.length} 条群消息？撤回后群成员将无法再查看这些消息。`
  if (name === REMOVE) {
    const restricted = items.filter(item => item.prevent_rejoin === true).length
    return `是否确认执行 ${items.length} 项群成员移出？其中 ${restricted} 项同时禁止再次加入；其他项保留原有入群限制。`
  }
  const restricted = items.filter(item => item.restricted === true).length
  return `是否确认设置这 ${items.length} 项群入群限制：禁止 ${restricted} 项、解除 ${items.length - restricted} 项？此操作不移出成员，也不自动邀请入群。`
}
