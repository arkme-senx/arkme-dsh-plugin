import { useEffect } from 'react'
import type { ArkmeSourceItem } from '../types.js'
import type { RecordMutationFeedback, RecordMutationReceipt as Receipt } from './record-mutation-feedback.js'
import { arkmeTheme } from './arkme-theme.js'

export function RecordMutationReceipt({ receipt, owner, onView, onRefresh }: {
  receipt: Receipt; owner: RecordMutationFeedback; onView(source: ArkmeSourceItem): void; onRefresh(): void
}) {
  useEffect(() => {
    if (receipt.phase !== 'confirmed') return
    const timer = setTimeout(() => owner.dismiss(receipt.id), 4_000)
    return () => clearTimeout(timer)
  }, [receipt.id, receipt.phase, owner])
  const pending = receipt.phase === 'pending', problem = receipt.phase === 'failed' || receipt.phase === 'uncertain'
  const text = receipt.message ?? (receipt.kind === 'delete'
    ? pending ? `已移除 ${receipt.count} 条内容，正在同步…` : `已删除 ${receipt.count} 条内容`
    : pending ? `${receipt.count} 条内容 →「${receipt.label}」· 正在同步…` : `已将 ${receipt.count} 条内容指定到「${receipt.label}」`)
  return <div data-arkme-record-mutation={receipt.phase} role={problem ? 'alert' : 'status'} style={{
    position: 'absolute', top: 8, left: '50%', transform: 'translateX(-50%)', zIndex: 6,
    maxWidth: 'calc(100% - 32px)', display: 'flex', gap: 10, alignItems: 'center', padding: '8px 12px',
    borderRadius: 10, background: arkmeTheme.base, color: problem ? arkmeTheme.danger : arkmeTheme.secondary,
    boxShadow: '0 2px 10px rgba(0,0,0,.09)', fontSize: 12,
  }}>
    <span style={{ minWidth: 0 }}>{pending ? '↗ ' : problem ? '' : '✓ '}{text}</span>
    {!problem && receipt.target && <button type="button" onClick={() => onView(receipt.target!)} style={{ flexShrink: 0, border: 0, background: 'none', color: arkmeTheme.accent, cursor: 'pointer' }}>查看主题</button>}
    {problem && <button type="button" onClick={onRefresh} style={{ flexShrink: 0, border: 0, background: 'none', color: 'inherit', cursor: 'pointer' }}>刷新核对</button>}
    {!pending && <button type="button" aria-label="关闭操作反馈" onClick={() => owner.dismiss(receipt.id)} style={{ border: 0, background: 'none', color: 'inherit', cursor: 'pointer' }}>×</button>}
  </div>
}
