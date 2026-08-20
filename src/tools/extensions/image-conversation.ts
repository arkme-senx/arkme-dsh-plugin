import type { Agent } from '@deepseek-ai/dsh-agent'

const DEFAULT_CONFIRMATION_TTL_MILLIS = 10 * 60_000
const MAX_PENDING_CONFIRMATIONS = 1024

interface PreparedMutation<Draft> {
  draft: Draft
  fingerprint: string
  preparedAfterSeq: number
  expiresAtMillis: number
  expectedReply: string
}

export interface ImageMutationConfirmation {
  status: 'confirmation_required'
  question: string
  expectedReply: string
  expiresAtMillis: number
}

export interface ArkmeImageMutationConversationOptions<Draft, Prepared, Result> {
  expectedReply(draft: Draft): string
  question(draft: Draft): string
  preflight(agent: Agent, draft: Draft, signal?: AbortSignal): Promise<{ fingerprint: string; prepared: Prepared }>
  apply(draft: Draft, prepared: Prepared, signal?: AbortSignal): Promise<Result>
  now?: () => number
  confirmationTtlMillis?: number
}

export class ArkmeImageMutationConversation<Draft, Prepared, Result> {
  private readonly pending = new Map<string, PreparedMutation<Draft>>()
  private readonly preparing = new Set<string>()
  private readonly confirming = new Set<string>()
  private readonly now: () => number
  private readonly confirmationTtlMillis: number

  constructor(private readonly options: ArkmeImageMutationConversationOptions<Draft, Prepared, Result>) {
    this.now = options.now ?? Date.now
    this.confirmationTtlMillis = options.confirmationTtlMillis ?? DEFAULT_CONFIRMATION_TTL_MILLIS
  }

  async prepare(agent: Agent, draft: Draft, signal?: AbortSignal): Promise<ImageMutationConfirmation> {
    const agentId = requiredAgentId(agent)
    this.clearExpired()
    if (this.preparing.has(agentId) || this.confirming.has(agentId)) {
      throw new Error('图片操作正在处理，请勿重复提交')
    }
    if (!this.pending.has(agentId) && this.pending.size >= MAX_PENDING_CONFIRMATIONS) {
      throw new Error('等待确认的图片操作过多，请稍后重试')
    }
    this.preparing.add(agentId)
    try {
      const checked = await this.options.preflight(agent, draft, signal)
      if (checked.fingerprint.trim() === '') throw new Error('图片操作预检没有生成有效内容指纹')
      const existing = this.pending.get(agentId)
      if (existing !== undefined) {
        if (existing.fingerprint !== checked.fingerprint) {
          throw new Error('当前已有等待确认的图片操作，请先回复“确认”完成该操作')
        }
        return {
          status: 'confirmation_required',
          question: this.options.question(existing.draft),
          expectedReply: existing.expectedReply,
          expiresAtMillis: existing.expiresAtMillis,
        }
      }
      const expectedReply = this.options.expectedReply(draft)
      const expiresAtMillis = this.now() + this.confirmationTtlMillis
      this.pending.set(agentId, {
        draft,
        fingerprint: checked.fingerprint,
        preparedAfterSeq: lastSessionSeq(agent),
        expiresAtMillis,
        expectedReply,
      })
      return {
        status: 'confirmation_required',
        question: this.options.question(draft),
        expectedReply,
        expiresAtMillis,
      }
    } finally {
      this.preparing.delete(agentId)
    }
  }

  async confirm(agent: Agent, signal?: AbortSignal): Promise<Result> {
    const agentId = requiredAgentId(agent)
    const pending = this.pending.get(agentId)
    if (pending === undefined) throw new Error('当前没有等待确认的图片操作')
    if (this.now() > pending.expiresAtMillis) {
      this.pending.delete(agentId)
      throw new Error('图片操作确认已过期，请重新准备')
    }
    if (!hasLaterDirectConfirmation(agent, pending.preparedAfterSeq, pending.expectedReply)) {
      throw new Error(`需要在准备操作后的新消息中确认，并回复“${pending.expectedReply}”`)
    }
    if (this.preparing.has(agentId) || this.confirming.has(agentId)) throw new Error('图片操作正在处理，请勿重复提交')
    this.confirming.add(agentId)
    try {
      const checked = await this.options.preflight(agent, pending.draft, signal)
      if (checked.fingerprint !== pending.fingerprint) {
        if (this.pending.get(agentId) === pending) this.pending.delete(agentId)
        throw new Error('图片内容或目标扩展已变化，请重新准备并确认')
      }
      if (this.pending.get(agentId) === pending) this.pending.delete(agentId)
      return await this.options.apply(pending.draft, checked.prepared, signal)
    } finally {
      this.confirming.delete(agentId)
    }
  }

  private clearExpired(): void {
    const now = this.now()
    for (const [agentId, pending] of this.pending) {
      if (now > pending.expiresAtMillis && !this.confirming.has(agentId)) this.pending.delete(agentId)
    }
  }
}

function requiredAgentId(agent: Agent): string {
  if (typeof agent.id !== 'string') throw new Error('当前 DSH Agent 会话身份无效')
  const id = agent.id.trim()
  if (id === '') throw new Error('当前 DSH Agent 会话身份无效')
  return id
}

function lastSessionSeq(agent: Agent): number {
  return agent.session.events.at(-1)?.seq ?? -1
}

function hasLaterDirectConfirmation(agent: Agent, preparedAfterSeq: number, expectedReply: string): boolean {
  const messages = agent.session.events.filter(event => event.seq > preparedAfterSeq
    && event.type === 'user/message' && event.data.source.kind === 'user')
  const latest = messages.at(-1)
  if (latest?.type !== 'user/message') return false
  const text = latest.data.content
    .filter(block => block.type === 'text')
    .map(block => block.text)
    .join('\n')
    .replace(/[。！!]+$/g, '')
    .trim()
  return text === expectedReply
}
