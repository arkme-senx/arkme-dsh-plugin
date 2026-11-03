import type { ArkmeArrangementItem } from '../types.js'
import { ArkmeArrangementDialog } from './ArkmeArrangementDialog.js'
import {
  useOccurrenceReviewInbox,
  useOccurrenceHistoricalMerge,
} from './use-arrangement-occurrences.js'
import {
  occurrenceTime,
  occurrenceStatusLabel,
  canMergeOccurrence,
} from './arrangement-occurrence-ui.js'
import { tr } from './locale.js'
import css from './arrangement-occurrence.css?inline'

export function ArkmeArrangementReviewInbox({
  accountScope,
  onClose,
  onApplied,
}: {
  accountScope: string
  onClose(): void
  onApplied?(item: ArkmeArrangementItem): void
}) {
  const { items, selected, error, busy, loading, decide, select, refresh } =
    useOccurrenceReviewInbox(accountScope, onApplied)
  return (
    <ArkmeArrangementDialog
      className="arkme-occurrence-modal"
      title="待确认识别"
      description="这些识别尚未新建安排，请确认是已有事项、另一件事，还是无需安排。"
      busy={busy}
      onClose={onClose}
    >
      <style>{css}</style>
      <main>
        {error && <p role="alert">{error}</p>}
        {loading && <p role="status">{tr('正在读取待确认识别…')}</p>}
        {!loading && items?.length === 0 && <p>{tr('暂无待确认识别')}</p>}
        {items?.map((r) => (
          <article className="arkme-occurrence-card" key={r.id}>
            <h3>{r.candidate.title}</h3>
            <p>{r.candidate.description}</p>
            <p className="arkme-occurrence-muted">
              {tr('识别时间')}：{occurrenceTime(r.recognized_at)} · {tr('安排时间')}：
              {r.candidate.due_at ? occurrenceTime(r.candidate.due_at) : tr('未设置')}
            </p>
            <p>{r.reason}</p>
            <fieldset disabled={busy}>
              <legend>{tr('可能对应的已有安排')}</legend>
              {r.peers.map((p) => (
                <label className="arkme-occurrence-peer" key={p.arrangementRef}>
                  <input
                    type="radio"
                    disabled={!canMergeOccurrence(p)}
                    name={'peer-' + r.id}
                    checked={selected[r.id] === p.arrangementRef}
                    onChange={() => select(r.id, p.arrangementRef)}
                  />
                  <div>
                    <strong>{p.title}</strong>
                    <small>
                      {p.dueAtMillis ? occurrenceTime(p.dueAtMillis) : tr('未设置时间')} ·{' '}
                      {occurrenceStatusLabel(p.status)}
                    </small>
                    <small>
                      {r.comparisons.find((c) => c.arrangementRef === p.arrangementRef)?.reason}
                    </small>
                  </div>
                </label>
              ))}
            </fieldset>
            <div className="arkme-occurrence-actions">
              <button
                type="button"
                disabled={busy || !selected[r.id]}
                onClick={() => {
                  void decide(r, 'merge')
                }}
              >
                {tr('归入所选安排')}
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  void decide(r, 'create')
                }}
              >
                {tr('这是另一件事，单独创建')}
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  void decide(r, 'ignore')
                }}
              >
                {tr('忽略此次识别')}
              </button>
            </div>
          </article>
        ))}
        <button type="button" disabled={busy || loading} onClick={refresh}>
          {tr('刷新待确认识别')}
        </button>
        <p className="arkme-occurrence-muted">
          {tr('每次最多展示50条；归入已有安排只增加来源，不改动其标题、时间或状态。')}
        </p>
      </main>
    </ArkmeArrangementDialog>
  )
}
export function ArkmeArrangementHistoricalMerge({
  accountScope,
  item,
  model,
  routeKey,
  onApplied,
}: {
  accountScope: string
  item: ArkmeArrangementItem
  model: string
  routeKey: string
  onApplied(item: ArkmeArrangementItem): void
}) {
  const {
    open,
    review,
    selected,
    error,
    busy,
    notice,
    comparisonTrace,
    preview,
    apply,
    close,
    toggle,
  } = useOccurrenceHistoricalMerge(accountScope, item, routeKey, onApplied)
  return (
    <div className="arkme-occurrence-history-trigger">
      <p className="arkme-recognition-muted">
        {tr('查找历史重复会使用当前手动识别模型发起比对请求，费用按账户规则计算；预览不修改安排。')}{' '}
        {model}
      </p>
      <button
        type="button"
        disabled={busy || !routeKey}
        onClick={() => {
          void preview()
        }}
      >
        {tr('查找历史重复并预览')}
      </button>
      {notice && <p role="status">{notice}</p>}
      {open && (
        <ArkmeArrangementDialog
          className="arkme-occurrence-modal"
          title="历史重复安排预览"
          description="当前安排作为主项。选择确认重复的条目后归并；主项的标题、时间、状态与提醒保持原样。"
          busy={busy}
          onClose={close}
        >
          <style>{css}</style>
          <main>
            <div className="arkme-occurrence-master">
              <strong>
                {tr('保留的主安排')}：{item.title}
              </strong>
              <p>{item.description}</p>
              <p>
                {item.dueAtMillis ? occurrenceTime(item.dueAtMillis) : tr('未设置时间')} ·{' '}
                {tr(
                  item.status === 'completed'
                    ? '已完成'
                    : item.status === 'following'
                      ? '跟进中'
                      : '已识别',
                )}
              </p>
            </div>
            {busy && !review && <p role="status">{tr('正在检索并比对历史事项…')}</p>}
            {error && <p role="alert">{error}</p>}
            {review && (
              <>
                {comparisonTrace && (
                  <details className="arkme-recognition-code">
                    <summary>{tr('查看本次比对请求与输出')}</summary>
                    <pre tabIndex={0}>
                      {JSON.stringify(
                        {
                          model: comparisonTrace.actual_model,
                          route: comparisonTrace.route_key,
                          policy: comparisonTrace.policy_version,
                          prompt: comparisonTrace.prompt,
                          raw_output: comparisonTrace.raw_output,
                          rules: comparisonTrace.rules,
                        },
                        null,
                        2,
                      )}
                    </pre>
                  </details>
                )}
                {review.model && (
                  <p className="arkme-occurrence-muted">
                    {tr('比对模型返回标识')}：{review.model}
                  </p>
                )}
                {!review.peers.length && <p>{tr('未检索到相关历史安排')}</p>}
                {review.peers.map((p) => {
                  const comparison = review.comparisons.find(
                      (c) => c.arrangementRef === p.arrangementRef,
                    ),
                    selectable = canMergeOccurrence(p)
                  return (
                    <label className="arkme-occurrence-peer" key={p.arrangementRef}>
                      <input
                        type="checkbox"
                        checked={selected.has(p.arrangementRef)}
                        disabled={busy || !selectable}
                        onChange={() => toggle(p.arrangementRef)}
                      />
                      <div>
                        <strong>{p.title}</strong>
                        <small>{p.description}</small>
                        <small>
                          {p.dueAtMillis ? occurrenceTime(p.dueAtMillis) : tr('未设置时间')} ·{' '}
                          {occurrenceStatusLabel(p.status)}
                        </small>
                        <small>
                          {tr(
                            comparison?.relation === 'same'
                              ? '判定为同次事项'
                              : comparison?.relation === 'different'
                                ? '判定为不同事项'
                                : '需要人工确认',
                          )}
                          ：{comparison?.reason ?? tr('未记录')}
                        </small>
                      </div>
                    </label>
                  )
                })}
                <footer>
                  <p className="arkme-occurrence-muted">
                    {tr(
                      '被归并条目将退出普通列表，旧编号继续指向主安排，原有来源保留。预览10分钟内有效；期间发生编辑时需重新预览。',
                    )}
                  </p>
                  <div className="arkme-occurrence-actions">
                    <button
                      type="button"
                      disabled={busy || !selected.size}
                      onClick={() => {
                        void apply()
                      }}
                    >
                      {tr('确认合并到此安排')} ({selected.size})
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => {
                        void preview()
                      }}
                    >
                      {tr('重新预览')}
                    </button>
                  </div>
                </footer>
              </>
            )}
          </main>
        </ArkmeArrangementDialog>
      )}
    </div>
  )
}
