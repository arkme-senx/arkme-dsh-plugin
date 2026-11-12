import { useState } from 'react'
import type { ArkmeRecordingVersion } from '../../types.js'
import { ArkmeConfirmDialog } from '../ArkmeConfirmDialog.js'
import { arkmeTheme as theme } from '../arkme-theme.js'
import { tr, useArkmeLocale, arkmeIntlLocale } from '../locale.js'

export function RecordingVersionDetails({ version }: { version: ArkmeRecordingVersion }) {
  useArkmeLocale()
  const [open, setOpen] = useState(false)
  const source = version.sourceState === 'stale' ? '录音或说话人已更正，此版本待更新。'
    : version.sourceState === 'current' ? '此版本来源与当前录音一致。'
    : '此历史版本缺少可核验的来源记录，暂无法确认是否基于最新录音。原内容已保留。'
  return <>
    <button type="button" style={{ border: 0, background: 'transparent', color: theme.secondary, font: 'inherit', fontSize: 12, cursor: 'pointer', whiteSpace: 'nowrap', padding: '6px 8px' }} onClick={() => setOpen(true)}>{tr('版本详情')}</button>
    {open && <ArkmeConfirmDialog layout="picker" titleId="recording-version-details" title={tr('版本详情')} busy={false} onClose={() => setOpen(false)} dialogStyle={{ padding: 22 }}>
      <h3 style={{ marginTop: 0 }}>{tr('版本详情')}</h3>
      {version.generatedAtMillis > 0 && <p>{tr('生成时间')}：{new Date(version.generatedAtMillis).toLocaleString(arkmeIntlLocale(), { hour12: false })}</p>}
      {version.modelDisplayName && <p>{tr('模型')}：{version.modelDisplayName}</p>}
      <p style={{ color: theme.secondary, lineHeight: 1.7 }}>{tr(source)}</p>
      <div style={{ textAlign: 'right' }}><button type="button" onClick={() => setOpen(false)} style={{ padding: '7px 16px', border: `1px solid ${theme.border}`, borderRadius: 7, color: theme.text, background: theme.base, font: 'inherit', cursor: 'pointer' }}>{tr('关闭')}</button></div>
    </ArkmeConfirmDialog>}
  </>
}
