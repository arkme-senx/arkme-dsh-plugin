import { CURRENT_RECORDING_STRATEGY } from '../../recording-strategy-contract.js'
import { arkmeTheme as theme } from '../arkme-theme.js'
import { tr, useArkmeLocale } from '../locale.js'

/** Describes new PC work, never relabels the selected day's historical results. */
export function RecordingProcessingVersion() {
  useArkmeLocale()
  return <span aria-label={tr('录音处理版本：{v0}', { v0: CURRENT_RECORDING_STRATEGY.name })}
    title={tr('新录音和新导入使用此版本，历史录音保留原处理版本')}
    style={{ flexShrink: 0, marginInlineStart: 12, padding: '3px 8px', borderRadius: 6, background: theme.layer2, color: theme.secondary, fontSize: 11, whiteSpace: 'nowrap' }}>
    {CURRENT_RECORDING_STRATEGY.name}
  </span>
}
