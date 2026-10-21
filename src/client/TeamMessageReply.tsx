import type { TeamMessage } from '../team-app-contract.js'
import { arkmeMessageCopyText } from './message-copy-text.js'
import { teamMessagePresentation } from './TeamMessageContent.js'
import { arkmeTheme } from './arkme-theme.js'
import { tr } from './locale.js'

export function TeamMessageReply({ parent, busy, onLocate }: { parent?: TeamMessage | undefined; busy?: boolean | undefined; onLocate(): void }) {
  const available = parent?.state === 'published' && parent.contentStatus === 'available'
  return <button type="button" data-team-message-reply aria-label={tr('定位原消息')} disabled={busy}
    onClick={event => { event.stopPropagation(); onLocate() }}
    style={{ display: 'block', width: '100%', textAlign: 'left', border: 0, borderLeft: `2px solid ${arkmeTheme.accent}`,
      borderRadius: 4, marginBottom: 6, padding: '4px 8px', background: arkmeTheme.extensionSource, color: arkmeTheme.secondary,
      fontSize: 12, lineHeight: '18px', cursor: busy ? 'wait' : 'pointer' }}>
    <span style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
      {busy ? tr('正在定位原消息…') : available ? `${parent.sender.nickname}：${arkmeMessageCopyText(teamMessagePresentation(parent)) || tr('[附件]')}` : parent ? tr('原消息已删除或不可查看') : tr('查看原消息')}
    </span>
  </button>
}
