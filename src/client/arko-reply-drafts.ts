import { arkoReplyScenes, type ArkoReplyScene } from '../arko-reply-management.js'
import { arkoReplyPromptReference } from '../arko-reply-prompt-reference.js'

export const arkoPromptMaxLength = 20000
export interface ArkoReplyPromptDraft { content: string; baseRevision: string; savedAtMillis: number }
export interface ArkoReplyPromptDraftBook { revision: number; scenes: Partial<Record<ArkoReplyScene, ArkoReplyPromptDraft>> }
export const emptyArkoReplyPromptDrafts = (): ArkoReplyPromptDraftBook => ({ revision: 0, scenes: {} })
// A separate namespace preserves earlier preference experiments without treating them as official prompt text.
const key = (scope: string) => `arkme:arko-reply-prompt-drafts:v1:${scope}`
export const officialArkoReplyPrompt = (scene: ArkoReplyScene): string => arkoReplyPromptReference.blocks[scene].map(block => `【${block.title}】\n${block.text}`).join('\n\n')
export const arkoReplyPromptContent = (book: ArkoReplyPromptDraftBook, scene: ArkoReplyScene): string => book.scenes[scene]?.content ?? officialArkoReplyPrompt(scene)
function validContent(value: unknown): value is string { return typeof value === 'string' && !!value.trim() && value.length <= arkoPromptMaxLength }
function validDraft(value: unknown): value is ArkoReplyPromptDraft {
  const draft = value as Partial<ArkoReplyPromptDraft> | null
  return !!draft && validContent(draft.content) && typeof draft.baseRevision === 'string' && draft.baseRevision.length > 0 && draft.baseRevision.length <= 128
    && typeof draft.savedAtMillis === 'number' && Number.isFinite(draft.savedAtMillis) && draft.savedAtMillis >= 0
}
/** Local drafts only. No model invocation or cloud prompt mutation. */
export function readArkoReplyPromptDrafts(scope: string): ArkoReplyPromptDraftBook {
  if (!scope || typeof localStorage === 'undefined') return emptyArkoReplyPromptDrafts()
  const raw = localStorage.getItem(key(scope))
  if (!raw) return emptyArkoReplyPromptDrafts()
  let value: ArkoReplyPromptDraftBook
  try { value = JSON.parse(raw) as ArkoReplyPromptDraftBook } catch { throw new Error('本机提示词草稿无法读取，请保留现有内容后重试') }
  if (!value || !Number.isSafeInteger(value.revision) || value.revision < 0 || !value.scenes || typeof value.scenes !== 'object' || Array.isArray(value.scenes)
    || Object.entries(value.scenes).some(([scene, draft]) => !arkoReplyScenes.includes(scene as ArkoReplyScene) || !validDraft(draft))) throw new Error('本机提示词草稿无法读取，请保留现有内容后重试')
  return value
}
export function saveArkoReplyPromptDraft(scope: string, scene: ArkoReplyScene, content: string | null, expectedRevision: number): ArkoReplyPromptDraftBook {
  if (!scope || typeof localStorage === 'undefined') throw new Error('本机草稿存储暂不可用')
  if (!arkoReplyScenes.includes(scene) || !officialArkoReplyPrompt(scene) || content !== null && !validContent(content)) throw new Error('提示词不能为空，且不能超过 20000 字')
  const current = readArkoReplyPromptDrafts(scope)
  if (current.revision !== expectedRevision) throw new Error('提示词草稿已在其他窗口更新，请重新打开后保存')
  const next: ArkoReplyPromptDraftBook = { revision: current.revision + 1, scenes: { ...current.scenes } }
  if (content === null || content === officialArkoReplyPrompt(scene)) delete next.scenes[scene]
  else next.scenes[scene] = { content, baseRevision: arkoReplyPromptReference.sourceRevision, savedAtMillis: Date.now() }
  localStorage.setItem(key(scope), JSON.stringify(next))
  return next
}
