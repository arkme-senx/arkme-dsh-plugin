import type { ReactionExpression } from '../reaction-contract.js'
import { reactionLibrary } from './reaction-library.js'
import { labelExpression } from './reaction-expression.js'
export const defaultReactionPhrases = ['👌 收到', '👍 赞同', '⏳ 处理中', '✅ 已完成', '💬 稍后回复', '☕ 辛苦了', '💪 加油', '🙏 谢谢']
export function readReactionCollection(scope: string): ReactionExpression[] {
  const library = reactionLibrary.read(scope)
  if (!library) return []
  return library.revision === 0 ? defaultReactionPhrases.map(label => labelExpression(label)) : library.items
}
export async function writeReactionCollection(scope: string, phrases: ReactionExpression[]) {
  await reactionLibrary.save(scope, phrases)
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
