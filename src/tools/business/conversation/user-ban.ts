import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ArkmeUserBanOwnerRecord, ArkmeUserBanOwnerSnapshot } from '../../../types.js'
import { defineArkmeCoreToolModule } from '../../contract/module.js'
import { withArkmeConfirmationContext } from '../../shared/conversational-confirmation.js'
import { taggedJSON, TEXT_OUTPUT } from '../../shared/output.js'

interface PreparedUserBanContext {
  sourceRef: string
  userId: number
  displayName: string
}

function safeSnapshot(snapshot: ArkmeUserBanOwnerSnapshot): Record<string, unknown> {
  return {
    displayName: snapshot.displayName,
    status: snapshot.banned ? 'banned' : 'unbanned',
    hasManagementRecord: snapshot.exists,
    ...(snapshot.record?.remark === undefined || snapshot.record.remark === ''
      ? {}
      : { remark: snapshot.record.remark }),
  }
}

function safeRecord(record: ArkmeUserBanOwnerRecord): Record<string, unknown> {
  return {
    displayName: record.displayName,
    status: record.status,
    ...(record.remark === '' ? {} : { remark: record.remark }),
  }
}

function remarkArg(value: unknown): string {
  const remark = typeof value === 'string' ? value.trim() : ''
  if (Array.from(remark).length > 255) throw new TypeError('封禁备注最多 255 个字符')
  return remark
}

function mutationArgs(value: unknown): { sourceRef: string; remark: string } {
  const input = value !== null && typeof value === 'object' ? value as Record<string, unknown> : {}
  const sourceRef = typeof input.source_ref === 'string' ? input.source_ref : ''
  if (sourceRef.trim() === '') throw new TypeError('封禁操作缺少私聊 source_ref')
  return { sourceRef, remark: remarkArg(input.remark) }
}

export const userBanStatusToolModule = defineArkmeCoreToolModule({
  meta: {
    id: 'business.conversation.user-ban-status.v1',
    toolName: 'arkme_user_ban_status',
    kind: 'business',
    phase: 'core',
    effect: 'read',
    profiles: ['business', 'hybrid'],
  },
  create: ports => defineTool({
    name: 'arkme_user_ban_status',
    description: 'Employee-only: read the independent ban state for one private-chat user. Pass an unchanged private_chat source_ref from arkme_sources_list. This never reads account cancellation or ordinary user status.',
    parameters: {
      source_ref: { type: 'string', required: true, description: 'Account-bound private_chat source_ref returned by arkme_sources_list.' },
    },
    output: TEXT_OUTPUT,
    isConcurrencySafe: () => true,
    execute: async (args, exec) => taggedJSON(
      'Arkme 私聊用户封禁状态', safeSnapshot(await ports.userBanStatus(args.source_ref, exec.signal)),
    ),
  }),
})

function mutationModule(banned: boolean) {
  const toolName = banned ? 'arkme_user_ban' as const : 'arkme_user_unban' as const
  return defineArkmeCoreToolModule({
    meta: {
      id: banned ? 'business.conversation.user-ban.v1' : 'business.conversation.user-unban.v1',
      toolName,
      kind: 'business',
      phase: 'core',
      effect: 'write',
      grant: 'explicit-user-write',
      profiles: ['business', 'hybrid'],
    },
    create: ports => withArkmeConfirmationContext(defineTool({
      name: toolName,
      description: banned
        ? 'Employee-only and only after an explicit current human request: idempotently ban the user bound to one unchanged private_chat source_ref. A later conversational confirmation is mandatory.'
        : 'Employee-only and only after an explicit current human request: idempotently unban the user bound to one unchanged private_chat source_ref. A later conversational confirmation is mandatory.',
      parameters: {
        source_ref: { type: 'string', required: true, description: 'Account-bound private_chat source_ref returned by arkme_sources_list.' },
        remark: { type: 'string', description: 'Optional employee remark, at most 255 characters.' },
      },
      output: TEXT_OUTPUT,
      execute: async (args, exec) => {
        const input = mutationArgs(args)
        return taggedJSON(
          banned ? 'Arkme 私聊用户封禁结果' : 'Arkme 私聊用户解封结果',
          safeRecord(await (banned ? ports.banPrivateChatUser : ports.unbanPrivateChatUser)(
            input.sourceRef, input.remark, exec.signal,
          )),
        )
      },
    }), {
      prepare: async (args, exec): Promise<PreparedUserBanContext> => {
        const input = mutationArgs(args)
        const snapshot = await ports.userBanStatus(input.sourceRef, exec.signal)
        return { sourceRef: snapshot.sourceRef, userId: snapshot.targetUserId, displayName: snapshot.displayName }
      },
      execute: async (args, exec, prepared) => {
        const input = mutationArgs(args)
        if (prepared.sourceRef !== input.sourceRef) throw new Error('封禁目标已变化，请重新发起')
        const current = await ports.userBanStatus(input.sourceRef, exec.signal)
        if (current.targetUserId !== prepared.userId || current.displayName !== prepared.displayName) {
          throw new Error('封禁目标已变化，请重新发起')
        }
        const result = await (banned ? ports.banPrivateChatUser : ports.unbanPrivateChatUser)(
          input.sourceRef, input.remark, exec.signal,
        )
        return taggedJSON(
          banned ? 'Arkme 私聊用户封禁结果' : 'Arkme 私聊用户解封结果', safeRecord(result),
        )
      },
    }),
  })
}

export const userBanToolModule = mutationModule(true)
export const userUnbanToolModule = mutationModule(false)
export const userBanToolModules = [userBanStatusToolModule, userBanToolModule, userUnbanToolModule]
