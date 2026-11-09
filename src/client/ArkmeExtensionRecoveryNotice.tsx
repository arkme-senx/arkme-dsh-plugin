import { arkmeIntlLocale, tr, useArkmeLocale } from './locale.js'
import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import type { ArkmeDesktopQuarantineStatus } from '../extensions/desktop-quarantine.js'
import { copyText } from './clipboard-text.js'
import { callArkme } from './api.js'
import { arkmeUi } from './ui-controller.js'
import { parseArkmeDesktopQuarantineStatus } from './desktop-quarantine-status.js'

type QuarantineOperation =
  | 'extensions.quarantine.status'
  | 'extensions.quarantine.dismiss'
  | 'extensions.quarantine.reenable'

export type ArkmeExtensionRecoveryNoticeRequest = (
  operation: QuarantineOperation,
  params?: Record<string, unknown>,
) => Promise<unknown>

export interface ArkmeExtensionRecoveryNoticeProps {
  request?: ArkmeExtensionRecoveryNoticeRequest
  onOpenExtensions?: () => void
}

const styles: Record<string, CSSProperties> = {
  root: {
    position: 'absolute', zIndex: 30, top: 20, left: '50%', transform: 'translateX(-50%)',
    width: 'min(640px, calc(100% - 40px))', padding: '16px 18px', borderRadius: 14, maxHeight: 'calc(100% - 40px)', overflowY: 'auto', boxSizing: 'border-box',
    border: '1px solid #f0cf8a', background: '#fffaf0', color: '#20283b',
    boxShadow: '0 14px 36px rgba(33, 41, 63, 0.16)', fontSize: 13, lineHeight: 1.55,
  },
  title: { margin: 0, fontSize: 16, lineHeight: 1.4, fontWeight: 650 },
  summary: { margin: '6px 0 0', color: '#4f5c75' },
  localExplanation: { margin: '5px 0 0', color: '#69758c' },
  list: { display: 'grid', gap: 7, margin: '12px 0 0', padding: 0, listStyle: 'none' },
  entry: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
    padding: '8px 10px', borderRadius: 9, background: 'rgba(238, 226, 196, 0.45)',
  },
  packageName: { minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' },
  details: {
    margin: '10px 0 0', maxHeight: 160, overflow: 'auto', padding: 10, borderRadius: 8,
    background: '#20283b', color: '#e8ecf5', whiteSpace: 'pre-wrap', wordBreak: 'break-word',
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 11,
  },
  actions: { display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, marginTop: 13 },
  button: {
    appearance: 'none', border: '1px solid #c8d0df', borderRadius: 8, padding: '7px 11px',
    background: '#fff', color: '#34415a', cursor: 'pointer', fontSize: 12,
  },
  primaryButton: { borderColor: '#496ee8', background: '#496ee8', color: '#fff' },
  error: { margin: '9px 0 0', color: '#b42318' },
}

const defaultRequest: ArkmeExtensionRecoveryNoticeRequest = async (operation, params) =>
  await callArkme<unknown>(operation, params)

export function ArkmeExtensionRecoveryNotice({
  request = defaultRequest,
  onOpenExtensions = () => { arkmeUi.showExtensions() },
}: ArkmeExtensionRecoveryNoticeProps) {
  useArkmeLocale()
  const [status, setStatus] = useState<ArkmeDesktopQuarantineStatus>()
  const [detailsVisible, setDetailsVisible] = useState(false)
  const [copied, setCopied] = useState(false)
  const [busyPackage, setBusyPackage] = useState<string>()
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true
    void request('extensions.quarantine.status').then(value => {
      if (active) setStatus(parseArkmeDesktopQuarantineStatus(value))
    }).catch(() => undefined)
    return () => { active = false }
  }, [request])

  const entries = useMemo(() => status?.entries.filter(entry => !entry.dismissed && !entry.resolved) ?? [], [status])
  if (status?.active !== true || entries.length === 0) return null

  const localSafeMode = status.mode === 'local-safe-mode'
  const unknown = tr('未记录')
  const diagnostics = [
    tr('发生时间') + '  ' + (status.createdAtMillis === undefined ? unknown : new Date(status.createdAtMillis).toLocaleString(arkmeIntlLocale())),
    tr('当前状态') + '  ' + tr('已停用，停用后 Arkme 已启动'),
    ...entries.flatMap(entry => [
      tr('插件名称') + '  ' + entry.packageName,
      tr('插件来源') + '  ' + (entry.localSource
        ? tr(entry.localSource.kind === 'archive' ? '安装包' : '本地目录') + '  ' + entry.localSource.path : unknown),
    ]),
    '', tr('Harness 原始错误'), status.failureLogTail || unknown,
  ].join('\n')
  const copyDiagnostics = async () => {
    setError('')
    try {
      await copyText(diagnostics + '\n\n' + tr('请根据以上诊断找到原插件项目。如果来源是安装包，请先定位源码。检查 Web 入口、激活函数和依赖服务的注册时机，复现后再修改。如果错误中出现 loading，它只表示检查当时的状态，请验证具体原因。修复并重新构建后，请告诉我何时点击「重新启用并重启」，以及用哪个实际操作验证插件功能。'))
      setCopied(true)
    } catch {
      setCopied(false)
      setError(tr('复制失败，可手动选择并复制详细原因。'))
    }
  }
  const dismiss = async () => {
    setError('')
    try {
      await Promise.all(entries.map(async entry => {
        await request('extensions.quarantine.dismiss', { packageName: entry.packageName })
      }))
      setStatus(current => current === undefined ? current : {
        ...current,
        entries: current.entries.map(entry => ({ ...entry, dismissed: true })),
      })
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '暂时无法关闭提示，请稍后重试')
    }
  }
  const reenable = async (packageName: string) => {
    setError('')
    setBusyPackage(packageName)
    try {
      await request('extensions.quarantine.reenable', { packageName })
    } catch (cause) {
      setBusyPackage(undefined)
      setError(cause instanceof Error ? cause.message : '重新启用失败，该扩展仍保持停用')
    }
  }

  return <section data-arkme-owned="extension-recovery-notice" role="status" style={styles.root}>
    <h2 style={styles.title}>{localSafeMode ? '已进入本地扩展安全模式' : '已安全启动'}</h2>
    <p style={styles.summary}>{status.failureSummary ?? (localSafeMode
      ? `无法确定具体故障扩展，已停用 ${String(entries.length)} 个本地开发扩展。`
      : `扩展 ${entries[0]!.packageName} 启动时加载失败，已自动停用。`)}</p>
    <p style={styles.localExplanation}>{localSafeMode
      ? '插件文件已保留，Arkme 其他功能可继续使用。修复本地插件后，可逐个重新启用并重启验证。'
      : '插件文件已保留，Arkme 其他功能可继续使用。修复该扩展后，可重新启用并重启验证。'}</p>
    <ul style={styles.list}>
      {entries.map(entry => <li key={entry.packageName} style={styles.entry}>
        <span style={styles.packageName} title={entry.packageName}>{entry.packageName}</span>
        <button
          type="button"
          style={{ ...styles.button, ...styles.primaryButton }}
          disabled={busyPackage !== undefined}
          data-arkme-quarantine-action="reenable"
          onClick={() => { void reenable(entry.packageName) }}
        >{busyPackage === entry.packageName ? '正在重新启用…' : '重新启用并重启'}</button>
      </li>)}
    </ul>
    {detailsVisible && <>
      <pre style={styles.details}>{diagnostics}</pre>
      <button type="button" style={styles.button} data-arkme-quarantine-action="copy"
        onClick={() => { void copyDiagnostics() }}>{copied ? tr('已复制诊断') : tr('复制诊断给 Agent')}</button>
    </>}
    {error !== '' && <p role="alert" style={styles.error}>{error}</p>}
    <div style={styles.actions}>
      <button
        type="button" style={styles.button} data-arkme-quarantine-action="details"
        onClick={() => { setCopied(false); setDetailsVisible(value => !value) }}
      >{detailsVisible ? '收起详细原因' : '查看详细原因'}</button>
      <button
        type="button" style={styles.button} data-arkme-quarantine-action="extensions"
        onClick={onOpenExtensions}
      >{tr("打开扩展管理")}</button>
      <button
        type="button" style={styles.button} data-arkme-quarantine-action="dismiss"
        onClick={() => { void dismiss() }}
      >{tr("知道了")}</button>
    </div>
  </section>
}
