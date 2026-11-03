import { ArkmeConversationRemovalStyles } from './ArkmeConversationRemovalFeedback.js'
import { ConversationActionFeedbackContext, useConversationActionFeedback } from './use-conversation-action-feedback.js'
import { createContext, useContext, type ReactNode } from 'react'
import { teamDirectoryPreferences, teamEntryKey, teamEntryPinned, useTeamDirectoryPreferences, type TeamEntryTarget } from './team-directory-preferences.js'
import { useConversationRemovalFeedback, type ConversationRemovalPhase } from './use-conversation-removal-feedback.js'
import type { ConversationVisibilityActivityEvidence } from './conversation-directory-visibility-overlay.js'

export const teamRemovalKey = (target: TeamEntryTarget) => `team-entry:${teamEntryKey(target)}`
export interface TeamEntryRemovalActions {
  phase(target: TeamEntryTarget): ConversationRemovalPhase | undefined
  pinned(target: TeamEntryTarget): boolean | undefined
  remove(target: TeamEntryTarget): Promise<void>
}
export const TeamEntryRemovalContext = createContext<TeamEntryRemovalActions | undefined>(undefined)
export const useTeamEntryRemovalActions = () => useContext(TeamEntryRemovalContext)

/** Adapt Team activity/visibility to the existing directory feedback. Never use
 * updatedAt: profile changes, reads and previews are not published activity. */
export function teamRemovalEvidence(account: string, targets: TeamEntryTarget[]) {
  const evidence = new Map<string, ConversationVisibilityActivityEvidence>()
  for (const target of targets) {
    const value = teamDirectoryPreferences.removalActivity(account, target)
    if (value) evidence.set(teamRemovalKey(target), value)
  }
  return evidence
}
export function teamRemovalActions<Row>(account: string,
    feedback: ReturnType<typeof useConversationRemovalFeedback<Row>>,
    rows: readonly Row[], targetFor: (row: Row) => TeamEntryTarget | undefined,
    pinnedFor: (row: Row) => boolean): TeamEntryRemovalActions {
  return {
    phase: target => feedback.phases.get(teamRemovalKey(target)),
    pinned: target => {
      const row = feedback.retainedRows.get(teamRemovalKey(target))
      return row === undefined ? undefined : pinnedFor(row)
    },
    async remove(target) {
      const key = teamEntryKey(target)
      const row = rows.find(row => { const value = targetFor(row); return value && teamEntryKey(value) === key })
      const activity = teamDirectoryPreferences.removalActivity(account, target)
      if (row === undefined || activity === undefined) return
      const entry = feedback.begin(row, activity)
      try {
        await teamDirectoryPreferences.remove(account, target)
        if (teamDirectoryPreferences.removingOrHidden(account, target)) feedback.accept(entry)
      } finally { feedback.finishPending(entry) }
    },
  }
}

export function TeamEntryRemovalList({ accountKey, targets, visible, children }: {
  accountKey: string; targets: TeamEntryTarget[]; visible: TeamEntryTarget[];
  children(rows: readonly TeamEntryTarget[]): ReactNode
}) {
  const preferences = useTeamDirectoryPreferences(accountKey)
  const actionFeedback = useConversationActionFeedback(accountKey)
  const rows = visible.map(target => ({ target, pinned: teamEntryPinned(preferences, target) }))
  const feedback = useConversationRemovalFeedback({ rows, rowKey: row => teamRemovalKey(row.target),
    activity: teamRemovalEvidence(accountKey, targets), scope: accountKey, enabled: true,
    canRetain: key => targets.some(t => teamRemovalKey(t) === key && teamDirectoryPreferences.removingOrHidden(accountKey, t)),
  })
  return <ConversationActionFeedbackContext.Provider value={actionFeedback.notify}><TeamEntryRemovalContext.Provider value={teamRemovalActions(accountKey, feedback, rows, row => row.target, row => row.pinned)}>
    <ArkmeConversationRemovalStyles />{children(feedback.rows.map(row => row.target))}{actionFeedback.feedback}
  </TeamEntryRemovalContext.Provider></ConversationActionFeedbackContext.Provider>
}
