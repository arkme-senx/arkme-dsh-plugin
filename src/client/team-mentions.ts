import type { TeamMention } from '../team-app-contract.js'
import { arkmeComposerDraftFromText, reconcileArkmeComposerMentions, type ArkmeComposerDraftSnapshot, type ArkmeComposerMention } from './composer-draft-store.js'

export function teamComposerDraft(text: string, mentions: readonly TeamMention[] = []): ArkmeComposerDraftSnapshot {
  const draft = arkmeComposerDraftFromText(text)
  draft.mentions = mentions.map(m => ({mentionRef:m.personRef,displayName:m.displayName,startIndex:arkmeComposerDraftFromText(text.slice(0,m.startIndex)).text.length,length:m.length}))
  return draft
}
export const teamMentions = (mentions: readonly ArkmeComposerMention[]): TeamMention[] => mentions.flatMap(m => m.mentionRef ? [{personRef:m.mentionRef,displayName:m.displayName,startIndex:m.startIndex,length:m.length}] : [])
export function rebaseTeamMentions(before: string, text: string, mentions: readonly TeamMention[] = []): TeamMention[] {
  return teamMentions(reconcileArkmeComposerMentions(before,text,mentions.map(m => ({...m,mentionRef:m.personRef}))))
}
