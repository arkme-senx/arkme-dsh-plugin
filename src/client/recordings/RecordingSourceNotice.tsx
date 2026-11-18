import type { ArkmeRecordingVersion } from '../../types.js'
import { arkmeTheme as theme } from '../arkme-theme.js'
import { tr, useArkmeLocale } from '../locale.js'

/** Source freshness belongs to the selected version, never to the latest version. */
export function RecordingSourceNotice({ version }: { version: ArkmeRecordingVersion }) {
  useArkmeLocale()
  if (version.status !== 'done' || !version.selectable || version.sourceState !== 'stale') return null
  return <div role="status" data-recording-source-state={version.sourceState ?? 'unknown'} style={{
    padding: '8px 12px', marginTop: 8, borderRadius: 8,
    background: theme.layer2, color: theme.secondary, fontSize: 13, lineHeight: 1.6,
  }}>
    {tr('录音或说话人信息已更正，此版本待更新。')}<br />{tr('原内容已保留，可使用“重新生成”。')}
  </div>
}
