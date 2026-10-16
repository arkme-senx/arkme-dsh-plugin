/** Versioned calendar prompt contract. Defaults must come from the owner service. */
export const REVIEW_PROMPT_LIMIT = 20000
export const REVIEW_PROMPT_KINDS = ['summary', 'timeline'] as const
export type ReviewPromptKind = typeof REVIEW_PROMPT_KINDS[number]
export const REVIEW_PROMPT_FIELDS = ['instruction', 'chunk', 'aggregate'] as const
export type ReviewPromptField = typeof REVIEW_PROMPT_FIELDS[number]
export interface ReviewPromptStages { instruction: string; chunk: string; aggregate: string }
export interface ReviewPromptConfig { baseVersion: string; summary: ReviewPromptStages; timeline: ReviewPromptStages }
export interface ReviewPromptSnapshot extends ReviewPromptConfig { constraints: string }
export interface ReviewPromptSupport { supported: boolean; snapshotReuse: boolean; defaults?: ReviewPromptSnapshot }
export interface ReviewPromptDraft { saved?: ReviewPromptConfig; editing?: ReviewPromptConfig }
export const blankReviewPrompts = (): ReviewPromptConfig => ({ baseVersion: '',
  summary: { instruction: '', chunk: '', aggregate: '' }, timeline: { instruction: '', chunk: '', aggregate: '' } })
const object = (v: unknown): Record<string, unknown> => {
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error('提示词配置格式不完整')
  return v as Record<string, unknown>
}
const text = (v: unknown, max: number, draft: boolean): string => {
  if (typeof v !== 'string' || v.length > max || (!draft && !v.trim())) throw new Error('提示词内容为空或超出长度限制')
  return v
}
export function parseReviewPromptConfig(value: unknown, draft = false): ReviewPromptConfig {
  const v = object(value)
  const stages = (value: unknown): ReviewPromptStages => {
    const s = object(value)
    return { instruction: text(s.instruction, REVIEW_PROMPT_LIMIT, draft), chunk: text(s.chunk, REVIEW_PROMPT_LIMIT, draft), aggregate: text(s.aggregate, REVIEW_PROMPT_LIMIT, draft) }
  }
  return { baseVersion: text(v.baseVersion, 200, draft), summary: stages(v.summary), timeline: stages(v.timeline) }
}
export function parseReviewPromptSnapshot(value: unknown): ReviewPromptSnapshot {
  return { ...parseReviewPromptConfig(value), constraints: text(object(value).constraints, REVIEW_PROMPT_LIMIT, false) }
}
export function promptConfigOnly(value: ReviewPromptConfig): ReviewPromptConfig {
  return { baseVersion: value.baseVersion, summary: { ...value.summary }, timeline: { ...value.timeline } }
}
export function sameReviewPrompts(a: ReviewPromptConfig | undefined, b: ReviewPromptConfig | undefined): boolean {
  return a === b || (!!a && !!b && JSON.stringify(promptConfigOnly(a)) === JSON.stringify(promptConfigOnly(b)))
}
export function parseReviewPromptSupport(value: unknown): ReviewPromptSupport {
  const v = object(value)
  if (v.supported === false) return { supported: false, snapshotReuse: false }
  if (v.supported !== true || typeof v.snapshot_reuse !== 'boolean') throw new Error('提示词服务版本暂不兼容')
  return { supported: true, snapshotReuse: v.snapshot_reuse, defaults: parseReviewPromptSnapshot(v.defaults) }
}
export function parseReviewPromptDraft(value: unknown): ReviewPromptDraft {
  const v = object(value)
  if (v.schemaVersion !== 1) throw new Error('草稿版本不兼容')
  return { ...(v.saved ? { saved: parseReviewPromptConfig(v.saved, true) } : {}), ...(v.editing ? { editing: parseReviewPromptConfig(v.editing, true) } : {}) }
}
export function reviewPromptStorageKey(accountScope: string): string {
  return `arkme:calendar-day-review:prompts:v1:${encodeURIComponent(accountScope)}`
}
