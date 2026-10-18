import { ChatCircle } from '@phosphor-icons/react/dist/icons/ChatCircle'
import { TeamChannelSettings } from '../../TeamMessagingPanel.js'
import { teamText as tr } from '../../team-messaging-i18n.js'
import { useArkmeLocale } from '../../locale.js'
import { TeamFeatureDialog } from './TeamFeatureDialog.js'

export function TeamMessageChannelDialog({ accountKey, teamRef, teamName, onClose, onViewConversations, onChanged }: {
  accountKey: string; teamRef: string; teamName: string; onClose(): void; onViewConversations(): void; onChanged(): void
}) {
  useArkmeLocale()
  return <TeamFeatureDialog title={tr('团队消息通道')} teamName={teamName} onClose={onClose} className="arkme-team-message-channel-dialog">
    <div className="arkme-team-message-channel-body">
      <button type="button" className="arkme-team-message-channel-conversations" onClick={onViewConversations}>
        <ChatCircle size={20} aria-hidden /><span>{tr('查看团队对话')}</span><span aria-hidden>›</span>
      </button>
      <TeamChannelSettings teamRef={teamRef} accountKey={accountKey} onChanged={onChanged} />
    </div>
  </TeamFeatureDialog>
}
