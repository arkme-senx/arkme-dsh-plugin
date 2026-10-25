import type { ReactionExpression } from '../reaction-contract.js'
import { reactionLibrary, type ReactionLibraryStore } from './reaction-library.js'
import { labelExpression } from './reaction-expression.js'
export const defaultReactionPhrases = ['👌 收到', '👍 赞同', '⏳ 处理中', '✅ 已完成', '💬 稍后回复', '☕ 辛苦了', '💪 加油', '🙏 谢谢']
export function readReactionCollection(scope: string, library: ReactionLibraryStore = reactionLibrary): ReactionExpression[] {
  const value = library.read(scope)
  if (!value) return []
  return value.revision === 0 ? defaultReactionPhrases.map(label => labelExpression(label)) : value.items
}
export async function writeReactionCollection(scope: string, phrases: ReactionExpression[], library: ReactionLibraryStore = reactionLibrary) {
  await library.save(scope, phrases)
}
export function orderReactionPhrases(all: string[], order: string[]): string[] {
  return [...new Set([...order.filter(label => all.includes(label)), ...all])]
}
export function moveReactionPhrase(all: string[], from: string, to: string): string[] {
  if (from === to || !all.includes(from) || !all.includes(to)) return all
  const next = all.filter(label => label !== from)
  next.splice(all.indexOf(to), 0, from)
  return next
}
