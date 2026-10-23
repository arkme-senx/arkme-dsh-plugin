import { ArkmeConfirmDialog } from './ArkmeConfirmDialog.js'
import { tr } from './locale.js'

export const ARKO_DELETION_BACKEND_NOTICE = '后端接口开发中，开发完成后此功能完整可用。'
const retentionDescription = '功能接通后，删除的消息将放入「数据管理 → 最近删除」，30 天内可恢复，之后自动清空。'

/** The entry and confirmation are ready; never hide history or create a fake bin before server support. */
export function ArkoMessageDeletionDialog({ count, onClose }: { count: number; onClose(): void }) {
  return <ArkmeConfirmDialog titleId="arkme-arko-delete-title" title={tr('删除所选 {v0} 条 Arko 消息？', { v0: String(count) })}
    description={<><span role="status">{tr(ARKO_DELETION_BACKEND_NOTICE)}</span><br />{tr(retentionDescription)}</>}
    confirmLabel={tr('确认删除')} busyLabel={tr('删除中…')} confirmTone="danger" confirmDisabled busy={false}
    onClose={onClose} onConfirm={() => { /* Requires the Arko message lifecycle API, not Record deletion. */ }} />
}

export function ArkoDeletedMessagesNotice() {
  return <section className="arkme-data-panel" aria-label={tr('Arko 对话消息')}>
    <strong>{tr('Arko 对话消息')}</strong>
    <p role="status">{tr(ARKO_DELETION_BACKEND_NOTICE)}</p>
    <small>{tr(retentionDescription)}</small>
  </section>
}
