import { Play } from '@phosphor-icons/react/dist/icons/Play'
import { Stop } from '@phosphor-icons/react/dist/icons/Stop'
import type { ArkmeRecordingWorkbenchItem } from '../../types.js'
import { ArkmeMessageSelectionBar } from '../ArkmeMessageSelectionBar.js'
import { ArkmeSelectActionIcon } from '../message-selection-presentation.js'
import { arkmeTheme } from '../arkme-theme.js'
import { useRecordingTranscriptCopyLinkAction } from './RecordingTranscriptCopyLink.js'

export function RecordingTranscriptSelectionBar({ items, scope, playing, onNotice, onCopy, onPlay, onForward, onExit }: {
  items: readonly ArkmeRecordingWorkbenchItem[]; scope: string; playing: boolean
  onNotice(text: string): void; onCopy(): void; onPlay(): void; onForward(): void; onExit(): void
}) {
  const copyLink = useRecordingTranscriptCopyLinkAction({ items, scope, onNotice })
  const canForward = items.length > 0 && items.every(item => item.sessionKey === items[0]!.sessionKey && item.transcriptSource === items[0]!.transcriptSource)
  return <ArkmeMessageSelectionBar count={items.length} ariaLabel="录音多选操作" actions={[
    { id: 'copy', label: '复制文本', icon: <ArkmeSelectActionIcon kind="copy" />, disabled: !items.length, onSelect: onCopy },
    copyLink,
    { id: 'forward', label: '转发', icon: <ArkmeSelectActionIcon kind="forward" />, disabled: !canForward,
      reason: !canForward ? '转发需选择同一次录音、同一转写来源的片段；复制和播放不受影响' : undefined, onSelect: onForward },
    { id: 'play', label: playing ? '停止' : '播放', icon: playing ? <Stop size={22} aria-hidden /> : <Play size={22} aria-hidden />,
      disabled: !items.length, onSelect: onPlay },
    { id: 'close', label: '退出多选', icon: <ArkmeSelectActionIcon kind="close" size={18} />, onSelect: onExit },
  ]}>
    <span style={{ fontSize: 11, color: arkmeTheme.secondary, whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums', marginRight: 4 }}>已选 {items.length}/150</span>
  </ArkmeMessageSelectionBar>
}
