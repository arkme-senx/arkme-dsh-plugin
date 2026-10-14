import type { ReactNode } from 'react'
import type { ArkmeBotSummary, ArkmeDirectoryContactProfile, ArkmeSourceItem } from '../../../types.js'
import { ArkmeJiwoBrandMark } from '../../ArkmeJiwoBrandMark.js'
import type { ArkmeDirectorySelection } from './contact-directory-state.js'
import { ContactProfileDetail } from './ContactProfileDetail.js'
import { ConversationProfileDetail } from './ConversationProfileDetail.js'
import { TeamDetailPane } from './TeamDetailPane.js'

export interface DirectoryDetailPaneProps {
  accountKey: string
  selection: ArkmeDirectorySelection
  onSelectionChange(selection: ArkmeDirectorySelection): void
  onSourceActivated(source: ArkmeSourceItem): void
  onBotActivated?(bot: ArkmeBotSummary): void
  onProfileUpdated?(profile: ArkmeDirectoryContactProfile): void
  renderUnmarkedSpeakerDetail?(candidateRef: string): ReactNode
}

/** Detail routing seam. Task-specific speaker UI is supplied by the caller and is not imported here. */
export function DirectoryDetailPane({
  accountKey,
  selection,
  onSelectionChange,
  onSourceActivated,
  renderUnmarkedSpeakerDetail,
  onProfileUpdated,
  onBotActivated,
}: DirectoryDetailPaneProps) {
  if (selection.kind === 'none') {
    return <div className="arkme-directory-detail-empty">
      <ArkmeJiwoBrandMark className="arkme-directory-detail-logo" style={{ width: 96, height: 96 }} />
    </div>
  }
  if (selection.kind === 'unmarked-speaker') {
    return <div className="arkme-directory-unmarked-speaker-detail" data-candidate-ref={selection.candidateRef}>
      {renderUnmarkedSpeakerDetail?.(selection.candidateRef)}
    </div>
  }
  if (selection.kind === 'group' || selection.kind === 'bot') {
    return <ConversationProfileDetail key={`${accountKey}:${selection.kind}:${selection.kind === 'group' ? selection.sourceRef : selection.bot.botRef}`} item={selection} onSourceActivated={onSourceActivated} {...(onBotActivated === undefined ? {} : { onBotActivated })} />
  }
  if (selection.kind === 'team') {
    return <TeamDetailPane key={`${accountKey}:${selection.teamRef}`} accountKey={accountKey} teamRef={selection.teamRef} initialView={selection.view ?? 'members'} />
  }
  return <ContactProfileDetail
    key={`${accountKey}:${selection.contactRef}`}
    accountKey={accountKey}
    contactRef={selection.contactRef}
    onSelectionCleared={() => { onSelectionChange({ kind: 'none' }) }}
    onSourceActivated={onSourceActivated}
    {...(onProfileUpdated === undefined ? {} : { onProfileUpdated })}
  />
}
