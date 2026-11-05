import { arkmeTheme } from './arkme-theme.js'
import { tr } from './locale.js'

/** One stable slot, so request state changes never move the oldest message. */
export function ConversationHistoryStatus({ loading, error, canLoad, onLoad }: {
  loading: boolean; error: string; canLoad: boolean; onLoad(): void
}) {
  const failed = error !== '' || !canLoad
  return <div data-arkme-history-status role={failed ? 'alert' : 'status'} aria-live="polite"
    style={{ minHeight: 28, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
      fontSize: 11, color: failed ? arkmeTheme.danger : arkmeTheme.secondary }}>
    {failed ? <>{error || tr('暂时无法继续加载，请刷新会话后重试')}
      {canLoad && <button type="button" onClick={onLoad} disabled={loading}
        style={{ border: 0, padding: 0, background: 'transparent', color: 'inherit', cursor: 'pointer', font: 'inherit' }}>
        {loading ? tr('正在重试…') : tr('重试加载更早消息')}
      </button>}</> : loading ? tr('正在加载更早消息…') : <button type="button" onClick={onLoad}
        style={{ border: 0, padding: 0, background: 'transparent', color: 'inherit', cursor: 'pointer', font: 'inherit' }}>
        {tr('继续加载更早消息')}
      </button>}
  </div>
}
