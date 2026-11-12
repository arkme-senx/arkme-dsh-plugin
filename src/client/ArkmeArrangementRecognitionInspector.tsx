import { CaretRight } from '@phosphor-icons/react/dist/icons/CaretRight'
import { ArkmeArrangementHistoricalMerge } from './ArkmeArrangementOccurrenceActions.js'
import { ArkmeArrangementDialog } from './ArkmeArrangementDialog.js'
import { PromptText, Rules, TraceContent, sourceNames } from './ArkmeArrangementRecognitionViews.js'
import {
  useArrangementRecognitionSettings,
  useArrangementRecognitionProcess,
} from './use-arrangement-recognition.js'
import { inspectArrangementTrace } from './arrangement-occurrence-ui.js'
import type { ArkmeArrangementItem } from '../types.js'
import type { ArrangementRecognitionSource } from '../arrangement-recognition.js'
import { ArkmeAutomaticAiSettings } from './ArkmeAutomaticAiSettings.js'
import { UnifiedModelPicker } from './UnifiedModelPicker.js'
import { tr, useArkmeLocale } from './locale.js'
import css from './arrangement-recognition.css?inline'

export function ArkmeArrangementRecognitionSettings({
  accountScope,
  onClose,
}: {
  accountScope: string
  onClose(): void
}) {
  useArkmeLocale()
  const {
    settings,
    source,
    setSource,
    error,
    setError,
    busy,
    loading,
    picker,
    setPicker,
    notice,
    setNotice,
    setAttempt,
    config,
    choices,
    model,
    save,
  } = useArrangementRecognitionSettings(accountScope)
  return (
    <ArkmeArrangementDialog
      title="安排识别设置"
      description="查看真实规则，为不同来源选择模型"
      busy={busy}
      onClose={onClose}
      trapPaused={picker}
    >
      <div className="arkme-recognition-settings-body">
        <nav aria-label={tr('识别来源')}>
          {(settings
            ? settings.sources.map(
                (source) => [source.source, sourceNames[source.source] ?? source.label] as const,
              )
            : Object.entries(sourceNames)
          ).map(([key, label]) => (
            <button
              type="button"
              key={key}
              aria-current={source === key ? 'page' : undefined}
              disabled={busy}
              onClick={() => {
                setSource(key as ArrangementRecognitionSource)
                if (settings) setError('')
                setNotice('')
              }}
            >
              {tr(label)}
            </button>
          ))}
        </nav>
        <main>
          {loading && <p role="status">{tr('正在读取后端配置…')}</p>}
          {error && (
            <div role="alert" className="arkme-recognition-error">
              {error}
              <button
                type="button"
                disabled={busy}
                onClick={() => setAttempt((value) => value + 1)}
              >
                {tr('重试')}
              </button>
            </div>
          )}
          {notice && (
            <p role="status" className="arkme-recognition-notice">
              {notice}
            </p>
          )}
          {config && !loading && (
            <>
              <h3>{tr(config.label)}</h3>
              <section className="arkme-recognition-model">
                <div>
                  <span>{tr('当前生效模型')}</span>
                  <strong>{model?.display_name ?? config.effective_route_key}</strong>
                  <code>{config.effective_route_key}</code>
                  <small>
                    {tr(
                      config.inherited
                        ? '继承默认模型'
                        : config.personal_route_key
                          ? '个人选择'
                          : '系统默认',
                    )}
                  </small>
                </div>
                <button type="button" disabled={busy} onClick={() => setPicker(true)}>
                  {tr('切换模型')}
                </button>
              </section>
              {config.personal_route_key && (
                <button
                  className="arkme-recognition-text-button"
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    void save('')
                  }}
                >
                  {tr(source === 'default' ? '恢复系统默认' : '恢复继承默认模型')}
                </button>
              )}
              {config.fallback_reason && <p role="alert">{config.fallback_reason}</p>}
              <p className="arkme-recognition-muted">
                {tr('选择仅影响后续安排提取；转写和录音总结使用各自的模型配置。')}
              </p>
              {source !== 'default' && (
                <Rules rules={config.rules} pipeline={config.pipeline} />
              )}
              {!!config.prompts.length && (
                <>
                  <h4>{tr('完整提示词模板')}</h4>
                  <p className="arkme-recognition-muted">
                    {tr(
                      '这是当前模板。每次执行会填入时间、来源和文本；单条安排中的识别过程显示当次请求。',
                    )}
                  </p>
                  {config.prompts.map((prompt) => (
                    <div key={prompt.name}>
                      <PromptText label={prompt.name} value={prompt.template} />
                      <small className="arkme-recognition-hash">SHA-256 {prompt.hash}</small>
                    </div>
                  ))}
                </>
              )}
              <footer>
                {tr('规则版本')}：{settings?.policy_version}
                <br />
                {tr('配置摘要')}：<code>{settings?.revision}</code>
              </footer>
            </>
          )}
          {source === 'default' && (
            <ArkmeAutomaticAiSettings
              key={accountScope}
              accountScope={accountScope}
              only={['arrangement_recognition']}
              compact
              title="自动识别与额度授权"
            />
          )}
        </main>
      </div>
      {picker && config && (
        <UnifiedModelPicker
          scene="arrangement"
          ariaLabel={tr('选择安排识别模型')}
          scopeLabel={tr(sourceNames[source] ?? source)}
          models={choices}
          currentId={'arrangement:' + config.effective_route_key}
          busy={busy}
          error={error}
          onClose={() => setPicker(false)}
          onApply={async (selected) => {
            if (!selected.arrangement) return false
            const ok = await save(selected.arrangement)
            if (ok) setPicker(false)
            return ok
          }}
        />
      )}
    </ArkmeArrangementDialog>
  )
}
export function ArkmeArrangementRecognitionProcess({
  accountScope,
  item,
  onApplied,
  onSettings,
}: {
  accountScope: string
  item: ArkmeArrangementItem
  onApplied(item: ArkmeArrangementItem): void
  onSettings(): void
}) {
  const {
    open,
    setOpen,
    result,
    preview,
    setPreview,
    inspectedTrace,
    setInspectedTrace,
    error,
    busy,
    setAttempt,
    manualRoute,
    manualModel,
    run,
    next,
  } = useArrangementRecognitionProcess(accountScope, item, onApplied)
  return (
    <section className="arkme-recognition-process">
      <style>{css}</style>
      <button
        type="button"
        className="arkme-recognition-process-trigger"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        {tr('识别过程')}
        <CaretRight size={16} aria-hidden style={{ transform: open ? 'rotate(90deg)' : undefined }} />
      </button>
      {open && (
        <div>
          {busy && <p role="status">{tr('正在处理…')}</p>}
          {error && (
            <p role="alert" className="arkme-recognition-error">
              {error}{' '}
              <button
                type="button"
                disabled={busy}
                onClick={() => setAttempt((value) => value + 1)}
              >
                {tr('重试')}
              </button>
            </p>
          )}
          {result?.reason && <p className="arkme-recognition-muted">{result.reason}</p>}
          {result?.trace && <TraceContent trace={result.trace} />}
          {inspectedTrace && (
            <button type="button" disabled={busy} onClick={() => setInspectedTrace('')}>
              {tr('查看最近一次识别')}
            </button>
          )}
          {result?.trace?.occurrence_decision && (
            <p>
              {tr('事项归并判断')}：{result.trace.occurrence_decision.reason}
            </p>
          )}
          {result?.trace?.match_trace_ids?.map((id, i) => (
            <button
              key={id}
              type="button"
              disabled={busy}
              onClick={() => inspectArrangementTrace(accountScope, item.arrangementRef, id)}
            >
              {tr('查看归并比对过程')} ({i + 1})
            </button>
          ))}

          <button type="button" disabled={busy} onClick={onSettings}>
            {tr('查看当前识别设置')}
          </button>
          {manualModel && (
            <ArkmeArrangementHistoricalMerge
              accountScope={accountScope}
              item={item}
              model={manualModel}
              routeKey={manualRoute}
              onApplied={onApplied}
            />
          )}
          {manualModel && (
            <div className="arkme-recognition-rerun">
              <h4>{tr('重新识别预览')}</h4>
              <p>
                {tr(
                  '将重新读取有权访问的原文，使用手动创建模型生成候选，将发起一次 AI 请求，费用按账户规则计算。确认前不会修改安排。',
                )}
              </p>
              <p>
                {tr('模型')}：{manualModel}
              </p>
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  void run()
                }}
              >
                {tr('重新识别并预览差异')}
              </button>
            </div>
          )}
          {preview && (
            <div className="arkme-recognition-preview">
              {preview.reason && <p role="status">{preview.reason}</p>}
              {preview.state === 'conflict' && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    setPreview(undefined)
                    setAttempt((value) => value + 1)
                  }}
                >
                  {tr('刷新模型与识别记录')}
                </button>
              )}
              {preview.trace && !next && (
                <p>
                  {tr(
                    preview.trace.status === 'no-result'
                      ? '未识别到可执行安排，原安排保留'
                      : '识别到多项或结果不明确，请保留原安排并手动检查',
                  )}
                </p>
              )}
              {next && (
                <>
                  <h4>{tr('确认修改内容')}</h4>
                  <table>
                    <thead>
                      <tr>
                        <th>{tr('字段')}</th>
                        <th>{tr('当前')}</th>
                        <th>{tr('识别候选')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr>
                        <th>{tr('标题')}</th>
                        <td>{item.title}</td>
                        <td>{next.title}</td>
                      </tr>
                      <tr>
                        <th>{tr('说明')}</th>
                        <td>{item.description || tr('未设置')}</td>
                        <td>{next.description || tr('未设置')}</td>
                      </tr>
                      <tr>
                        <th>{tr('时间')}</th>
                        <td>
                          {item.dueAtMillis
                            ? new Date(item.dueAtMillis).toLocaleString()
                            : tr('未设置')}
                        </td>
                        <td>
                          {next.due_at ? new Date(next.due_at).toLocaleString() : tr('未设置')}
                        </td>
                      </tr>
                    </tbody>
                  </table>
                  <p>{tr('应用到此安排，保留原 UID、状态和来源；不新增安排。')}</p>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      void run(true)
                    }}
                  >
                    {tr('确认应用这些修改')}
                  </button>
                  <button type="button" disabled={busy} onClick={() => setPreview(undefined)}>
                    {tr('保留原安排')}
                  </button>
                </>
              )}
            </div>
          )}
        </div>
      )}
    </section>
  )
}
