import { randomUUID } from 'node:crypto'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { ArkmeExtensionPublishResult, ArkmeExtensionVisibility } from '../../extensions/types.js'
import type { ArkmeMyExtensionPublishInput, ArkmePreparedExtensionPublish } from '../../extensions/owned-types.js'
import { hasLaterDirectUserMessage, lastSessionSeq } from '../shared/conversational-confirmation.js'

const DEFAULT_CONFIRMATION_TTL_MILLIS = 10 * 60_000
const MAX_PUBLISH_BATCH_SIZE = 10

export type ArkmeExtensionPublishDraft = Omit<ArkmeMyExtensionPublishInput, 'clientMutationId'>

export interface ArkmeExtensionPublishBatchPreview {
  status: 'confirmation_required'
  count: number
  question: string
  items: Array<{
    ownedRef: string
    name: string
    version: string
    visibility: ArkmeExtensionVisibility
  }>
  expiresAtMillis: number
}

export interface ArkmeExtensionPublishBatchResult {
  status: 'published' | 'completed_with_failures'
  published: number
  failed: number
  items: Array<{
    ownedRef: string
    name: string
    version: string
    status: 'published' | 'failed'
    extensionId?: string
    message?: string
  }>
}

interface PendingPublishBatch {
  preparedAfterSeq: number
  expiresAtMillis: number
  items: ArkmePreparedExtensionPublish[]
}

export interface ArkmeExtensionPublishConversationOptions {
  preflight(input: ArkmeMyExtensionPublishInput, signal?: AbortSignal): Promise<ArkmePreparedExtensionPublish>
  publish(input: ArkmeMyExtensionPublishInput, signal?: AbortSignal): Promise<ArkmeExtensionPublishResult>
  now?: () => number
  createMutationId?: () => string
  confirmationTtlMillis?: number
}

export class ArkmeExtensionPublishConversation {
  private readonly pending = new Map<string, PendingPublishBatch>()
  private readonly now: () => number
  private readonly createMutationId: () => string
  private readonly confirmationTtlMillis: number

  constructor(private readonly options: ArkmeExtensionPublishConversationOptions) {
    this.now = options.now ?? Date.now
    this.createMutationId = options.createMutationId ?? randomUUID
    this.confirmationTtlMillis = options.confirmationTtlMillis ?? DEFAULT_CONFIRMATION_TTL_MILLIS
  }

  async prepare(agent: Agent, drafts: ArkmeExtensionPublishDraft[], signal?: AbortSignal): Promise<ArkmeExtensionPublishBatchPreview> {
    const agentId = requiredAgentId(agent)
    const existing = this.pending.get(agentId)
    if (existing !== undefined) {
      if (this.now() > existing.expiresAtMillis) {
        this.pending.delete(agentId)
      } else if (!hasLaterDirectUserMessage(agent, existing.preparedAfterSeq)) {
        throw new Error('当前已有等待确认的扩展发布批次，请先在对话中处理该批次')
      }
    }
    if (drafts.length <= 0 || drafts.length > MAX_PUBLISH_BATCH_SIZE) {
      throw new Error(`一次只能准备发布 1-${String(MAX_PUBLISH_BATCH_SIZE)} 个扩展`)
    }
    const inputs = drafts.map(draft => normalizeDraft(draft, this.createMutationId()))
    if (new Set(inputs.map(item => item.ownedRef)).size !== inputs.length) {
      throw new Error('同一批次不能重复发布同一个扩展')
    }
    const items: ArkmePreparedExtensionPublish[] = []
    for (const input of inputs) items.push(await this.options.preflight(input, signal))
    const expiresAtMillis = this.now() + this.confirmationTtlMillis
    this.pending.set(agentId, {
      preparedAfterSeq: lastSessionSeq(agent),
      expiresAtMillis,
      items,
    })
    return {
      status: 'confirmation_required',
      count: items.length,
      question: publishQuestion(inputs),
      items: inputs.map(item => ({
        ownedRef: item.ownedRef,
        name: item.name,
        version: item.version,
        visibility: item.visibility,
      })),
      expiresAtMillis,
    }
  }

  async confirm(agent: Agent, signal?: AbortSignal): Promise<ArkmeExtensionPublishBatchResult> {
    const agentId = requiredAgentId(agent)
    const pending = this.pending.get(agentId)
    if (pending === undefined) throw new Error('当前没有等待确认的扩展发布批次')
    if (this.now() > pending.expiresAtMillis) {
      this.pending.delete(agentId)
      throw new Error('扩展发布确认已过期，请重新准备发布')
    }
    if (!hasLaterDirectUserMessage(agent, pending.preparedAfterSeq)) {
      throw new Error('需要用户在准备发布后的新消息中明确确认')
    }
    for (const prepared of pending.items) {
      const current = await this.options.preflight(prepared.input, signal)
      if (current.sourceFingerprint !== prepared.sourceFingerprint) {
        this.pending.delete(agentId)
        throw new Error(`扩展“${prepared.input.name}”的源码或 Bundle 已变化，请重新准备并确认发布`)
      }
    }
    this.pending.delete(agentId)
    const items: ArkmeExtensionPublishBatchResult['items'] = []
    for (const prepared of pending.items) {
      const input = prepared.input
      try {
        const result = await this.options.publish(input, signal)
        if (result.status !== 'published') {
          throw new Error(`扩展发布尚未完成，当前状态：${result.status}`)
        }
        items.push({
          ownedRef: input.ownedRef,
          name: input.name,
          version: input.version,
          status: 'published',
          extensionId: result.extension_id,
        })
      } catch (error) {
        items.push({
          ownedRef: input.ownedRef,
          name: input.name,
          version: input.version,
          status: 'failed',
          message: error instanceof Error ? error.message : String(error),
        })
      }
    }
    const published = items.filter(item => item.status === 'published').length
    return {
      status: published === items.length ? 'published' : 'completed_with_failures',
      published,
      failed: items.length - published,
      items,
    }
  }

}

function normalizeDraft(draft: ArkmeExtensionPublishDraft, clientMutationId: string): ArkmeMyExtensionPublishInput {
  const ownedRef = draft.ownedRef.trim()
  const name = draft.name.trim()
  const description = draft.description.trim()
  const version = draft.version.trim()
  if (ownedRef === '' || name === '' || version === '') throw new Error('发布扩展、名称和版本不能为空')
  if (!['private', 'unlisted', 'public'].includes(draft.visibility)) throw new Error('扩展可见范围无效')
  const changelog = draft.changelog?.trim() ?? ''
	const githubRepositoryUrl = draft.githubRepositoryUrl?.trim() ?? ''
  return {
    ownedRef,
    name,
    description,
    version,
    visibility: draft.visibility,
    ...(changelog === '' ? {} : { changelog }),
		...(githubRepositoryUrl === '' ? {} : { githubRepositoryUrl }),
    clientMutationId,
  }
}

function publishQuestion(inputs: ArkmeMyExtensionPublishInput[]): string {
  if (inputs.length === 1) {
    const item = inputs[0]!
		return `是否确认发布“${item.name}” ${item.version}，可见范围为${visibilityLabel(item.visibility)}${sourceConfirmation(item)}？`
  }
  return `是否确认一次发布以下 ${String(inputs.length)} 个扩展？\n${inputs
		.map(item => `- ${item.name} ${item.version}，${visibilityLabel(item.visibility)}${sourceConfirmation(item)}`)
    .join('\n')}`
}

function sourceConfirmation(input: ArkmeMyExtensionPublishInput): string {
	return input.githubRepositoryUrl === undefined
		? ''
		: `，GitHub 来源：${input.githubRepositoryUrl}（仅当前内测资格账号可发布）`
}

function visibilityLabel(visibility: ArkmeExtensionVisibility): string {
  switch (visibility) {
    case 'private': return '仅自己'
    case 'unlisted': return '通过链接访问'
    case 'public': return '公开'
  }
}

function requiredAgentId(agent: Agent): string {
  const id = String(agent.id).trim()
  if (id === '') throw new Error('当前 DSH Agent 会话身份无效')
  return id
}
