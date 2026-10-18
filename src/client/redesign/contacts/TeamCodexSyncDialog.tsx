import type { ArkmeTeamMemberPage } from '../../../types.js'
import { tr, useArkmeLocale } from '../../locale.js'
import { TeamCodexActivity } from './TeamCodexActivity.js'
import { TeamFeatureDialog } from './TeamFeatureDialog.js'

export function TeamCodexSyncDialog({ team, onClose, onViewConversations }: {
  team: ArkmeTeamMemberPage['team']
  onClose(): void
  onViewConversations(): void
}) {
  useArkmeLocale()
  return <TeamFeatureDialog title={tr('Codex 同步')} teamName={team.name} onClose={onClose}
    footer={<button type="button" onClick={onViewConversations}>{tr('查看团队对话')} <span aria-hidden="true">›</span></button>}>
    <TeamCodexActivity teamRef={team.teamRef} team={team} managementOnly />
  </TeamFeatureDialog>
}
