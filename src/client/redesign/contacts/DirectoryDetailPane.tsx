import type { ReactNode } from 'react'
import type { ArkmeSourceItem } from '../../../types.js'
import arkmeNavigationLogoBase64 from '../../../../assets/branding/arkme-navigation-logo.png'
import arkmeNavigationLogoDarkBase64 from '../../../../assets/branding/arkme-navigation-logo-dark.png'
import type { ArkmeDirectorySelection } from './contact-directory-state.js'
import { ContactProfileDetail } from './ContactProfileDetail.js'

export interface DirectoryDetailPaneProps {
  accountKey: string
  selection: ArkmeDirectorySelection
  onSelectionChange(selection: ArkmeDirectorySelection): void
  onSourceActivated(source: ArkmeSourceItem): void
  renderUnmarkedSpeakerDetail?(candidateRef: string): ReactNode
}

/** Detail routing seam. Task-specific speaker UI is supplied by the caller and is not imported here. */
export function DirectoryDetailPane({
  accountKey,
  selection,
  onSelectionChange,
  onSourceActivated,
  renderUnmarkedSpeakerDetail,
}: DirectoryDetailPaneProps) {
  if (selection.kind === 'none') {
    return <div className="arkme-directory-detail-empty">
      <img
        className="arkme-directory-detail-logo"
        src={`data:image/png;base64,${arkmeNavigationLogoBase64}`}
        alt="Arkme"
        data-arkme-theme-image="light"
        draggable={false}
      />
      <img
        className="arkme-directory-detail-logo"
        src={`data:image/png;base64,${arkmeNavigationLogoDarkBase64}`}
        alt="Arkme"
        data-arkme-theme-image="dark"
        draggable={false}
      />
    </div>
  }
  if (selection.kind === 'unmarked-speaker') {
    return <div className="arkme-directory-unmarked-speaker-detail" data-candidate-ref={selection.candidateRef}>
      {renderUnmarkedSpeakerDetail?.(selection.candidateRef)}
    </div>
  }
  return <ContactProfileDetail
    key={`${accountKey}:${selection.contactRef}`}
    accountKey={accountKey}
    contactRef={selection.contactRef}
    onSelectionCleared={() => { onSelectionChange({ kind: 'none' }) }}
    onSourceActivated={onSourceActivated}
  />
}
