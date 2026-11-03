import type { CSSProperties } from 'react'
import { CircleNotch } from '@phosphor-icons/react/dist/icons/CircleNotch'
import { Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import { arkmeTheme } from '../arkme-theme.js'
import { tr } from '../locale.js'
import { RecordingDesktopIcon } from './RecordingDesktopIcon.js'

export function RecordingTranscriptExportButton({ pending, error, loadedCount, style, onExport }: {
  pending: boolean; error: string; loadedCount: number; style?: CSSProperties | undefined; onExport: () => Promise<void>
}) {
  return <span style={{ position: 'relative', display: 'flex', flex: 'none' }}>
    <Tooltip label={tr(pending ? '正在准备完整转写…' : '下载完整转写')} side="bottom" delayMs={200}>
    <button data-arkme-feedback="neutral" type="button" aria-label={tr('导出')} aria-busy={pending}
      title={tr(pending ? '正在准备完整转写…' : '下载完整转写')} disabled={pending}
      style={{ ...style, ...(pending ? { cursor: 'wait' } : {}) }} onClick={() => { void onExport() }}>
      {pending ? <CircleNotch size={20} className="arkme-icon-spin" aria-hidden /> : <RecordingDesktopIcon name="export" size={20} />}
    </button>
    </Tooltip>
    {(pending || error !== '') && <span role="status" aria-live="polite" data-recording-export-status
      style={{ position: 'absolute', right: 0, top: 'calc(100% + 8px)', zIndex: 3, width: 250,
        maxWidth: 'calc(100vw - 48px)', padding: '8px 10px', boxSizing: 'border-box', borderRadius: 8,
        border: `1px solid ${arkmeTheme.border}`, background: arkmeTheme.base, color: arkmeTheme.secondary,
        fontSize: 12, lineHeight: '18px', whiteSpace: 'normal', overflowWrap: 'anywhere' }}>
      {pending ? <><span style={{ display: 'block' }}>{tr('正在准备完整转写…')}</span>
        <span>{tr('已读取 {v0} 段，完成后自动下载', { v0: String(loadedCount) })}</span></>
        : <>{tr(error)} <button type="button" aria-label={tr('重试下载完整转写')}
          style={{ padding: 0, border: 0, background: 'transparent', color: 'inherit', textDecoration: 'underline', cursor: 'pointer', font: 'inherit' }}
          onClick={() => { void onExport() }}>{tr('重试')}</button></>}
    </span>}
  </span>
}
