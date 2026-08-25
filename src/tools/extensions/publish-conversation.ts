import { randomUUID } from 'node:crypto'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { ArkmeExtensionPublishResult, ArkmeExtensionVisibility } from '../../extensions/types.js'
import type { ArkmeExtensionPublishArtifactKind, ArkmeExtensionPublishRoute,
  ArkmeMyExtensionPublishInput, ArkmePreparedExtensionPublish,
} from '../../extensions/owned-types.js'
import { hasLaterDirectUserMessage, lastSessionSeq } from '../shared/conversational-confirmation.js'
import { normalizeGitHubRepositoryURL } from '../../extensions/source.js'

const DEFAULT_CONFIRMATION_TTL_MILLIS = 10 * 60_000
const MAX_PUBLISH_BATCH_SIZE = 10

export type ArkmeExtensionPublishDraft = Omit<ArkmeMyExtensionPublishInput, 'clientMutationId'>

export interface ArkmeExtensionPublishBatchPreview {
  status: 'confirmation_required'
  count: number
  question: string
  items: Array<{
    ownedRef: string
    extensionId?: string
    name: string
    version: string
    visibility: ArkmeExtensionVisibility
    publishRoute: ArkmeExtensionPublishRoute
    artifactContractVersion: 2 | 3
    artifactKind: ArkmeExtensionPublishArtifactKind
    nativeCapabilities?: import('../../extensions/types.js').ArkmeNativeCapability[]
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
    publishRoute: ArkmeExtensionPublishRoute
    artifactContractVersion: 2 | 3
    artifactKind: ArkmeExtensionPublishArtifactKind
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
    const extensionIds = inputs.flatMap(item => item.extensionId === undefined ? [] : [item.extensionId])
    if (new Set(extensionIds).size !== extensionIds.length) {
      throw new Error('同一批次不能重复更新同一个已有扩展')
    }
    const items: ArkmePreparedExtensionPublish[] = []
    for (const input of inputs) items.push(await this.options.preflight(input, signal))
    const preparedInputs = items.map(item => item.input)
    const preparedExtensionIds = preparedInputs.flatMap(item => item.extensionId === undefined ? [] : [item.extensionId])
    if (new Set(preparedExtensionIds).size !== preparedExtensionIds.length) {
      throw new Error('同一批次不能重复更新同一个已有扩展')
    }
    const expiresAtMillis = this.now() + this.confirmationTtlMillis
    this.pending.set(agentId, {
      preparedAfterSeq: lastSessionSeq(agent),
      expiresAtMillis,
      items,
    })
    return {
      status: 'confirmation_required',
      count: items.length,
      question: publishQuestion(items),
      items: items.map(prepared => {
        const item = prepared.input
        return {
          ownedRef: item.ownedRef,
          ...(item.extensionId === undefined ? {} : { extensionId: item.extensionId }),
          name: item.name,
          version: item.version,
          visibility: item.visibility,
          publishRoute: prepared.publishRoute,
          artifactContractVersion: prepared.artifactContractVersion,
          artifactKind: prepared.artifactKind,
          ...(prepared.nativeCapabilities === undefined ? {} : { nativeCapabilities: [...prepared.nativeCapabilities] }),
        }
      }),
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
      if (current.sourceFingerprint !== prepared.sourceFingerprint
        || current.input.extensionId !== prepared.input.extensionId) {
        this.pending.delete(agentId)
        throw new Error(`扩展“${prepared.input.name}”的源码或 Bundle 已变化，或发布目标已变化，请重新准备并确认发布`)
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
          publishRoute: prepared.publishRoute,
          artifactContractVersion: prepared.artifactContractVersion,
          artifactKind: prepared.artifactKind,
        })
      } catch (error) {
        items.push({
          ownedRef: input.ownedRef,
          name: input.name,
          version: input.version,
          status: 'failed',
          message: error instanceof Error ? error.message : String(error),
          publishRoute: prepared.publishRoute,
          artifactContractVersion: prepared.artifactContractVersion,
          artifactKind: prepared.artifactKind,
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
  const extensionId = draft.extensionId?.trim() ?? ''
  const name = draft.name.trim()
  const description = draft.description.trim()
  const version = draft.version.trim()
  if (ownedRef === '' || name === '' || version === '') throw new Error('发布扩展、名称和版本不能为空')
  if (extensionId !== '' && !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(extensionId)) {
    throw new Error('已有扩展身份无效')
  }
  if (!['private', 'unlisted', 'public'].includes(draft.visibility)) throw new Error('扩展可见范围无效')
  const changelog = draft.changelog?.trim() ?? ''
	const githubRepositoryUrl = normalizeGitHubRepositoryURL(draft.githubRepositoryUrl)
  return {
    ownedRef,
    ...(extensionId === '' ? {} : { extensionId }),
    name,
    description,
    version,
    visibility: draft.visibility,
    ...(changelog === '' ? {} : { changelog }),
		...(githubRepositoryUrl === undefined ? {} : { githubRepositoryUrl }),
    clientMutationId,
  }
}

function publishQuestion(items: ArkmePreparedExtensionPublish[]): string {
  if (items.length === 1) {
    const item = items[0]!
			return `是否确认发布“${item.input.name}” ${item.input.version}，可见范围为${visibilityLabel(item.input.visibility)}${sourceConfirmation(item)}？`
  }
  return `是否确认一次发布以下 ${String(items.length)} 个扩展？\n${items
			.map(item => `- ${item.input.name} ${item.input.version}，${visibilityLabel(item.input.visibility)}${sourceConfirmation(item)}`)
    .join('\n')}`
}

function sourceConfirmation(prepared: ArkmePreparedExtensionPublish): string {
  const input = prepared.input
	const contract = prepared.publishRoute === 'profile-native-v3'
		? `，发布方式：V3 原生 DSH Package${(prepared.nativeCapabilities?.length ?? 0) === 0 ? '（未检测到额外原生能力）' : `（原生能力：${prepared.nativeCapabilities!.join('、')}）`}`
		: prepared.publishRoute === 'profile-sandbox-v2'
			? '，发布方式：Profile 中已保存的 V2 沙箱 Bundle'
			: '，发布方式：当前会话 Cordis 插件（先保存到 Profile，再发布 V2 沙箱 Bundle）'
	const github = input.githubRepositoryUrl === undefined
		? ''
		: `，GitHub 来源：${input.githubRepositoryUrl}`
		return `${input.extensionId === undefined ? '' : `，更新已有扩展 ${input.extensionId}`}${contract}${github}`
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
