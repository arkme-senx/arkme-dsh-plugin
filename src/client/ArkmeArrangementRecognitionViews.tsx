import type { ArrangementRecognitionTrace } from '../arrangement-recognition.js'
import { arrangementRecognitionSourceNames } from '../arrangement-recognition.js'
import { tr } from './locale.js'

export const sourceNames: Readonly<Record<string, string>> = arrangementRecognitionSourceNames
export function PromptText({ label, value }: { label: string; value: string }) {
  return (
    <details className="arkme-recognition-code">
      <summary>{label}</summary>
      <pre tabIndex={0}>{value}</pre>
    </details>
  )
}
export function Rules({ rules, pipeline }: { rules: string[]; pipeline: string[] }) {
  return (
    <>
      <h4>{tr('处理链路')}</h4>
      {pipeline.map((line, i) => (
        <p className="arkme-recognition-pipeline" key={i}>
          {line}
        </p>
      ))}
      <h4>{tr('后端规则与限制')}</h4>
      <ul>
        {rules.map((rule, i) => (
          <li key={i}>{rule}</li>
        ))}
      </ul>
    </>
  )
}

export function TraceContent({ trace }: { trace: ArrangementRecognitionTrace }) {
  return (
    <>
      <dl className="arkme-recognition-facts">
        <div>
          <dt>{tr('请求模型')}</dt>
          <dd>
            {trace.display_name} · {trace.provider}
            <br />
            <code>{trace.route_key}</code>
          </dd>
        </div>
        <div>
          <dt>{tr('模型返回标识')}</dt>
          <dd>
            {trace.actual_model || tr('未记录')}
            <br />
            {trace.provider_request_uid && <code>{trace.provider_request_uid}</code>}
          </dd>
        </div>
        <div>
          <dt>{tr('执行状态')}</dt>
          <dd>
            {tr(
              {
                processing: '处理中或已中断',
                'model-returned': '模型已返回',
                'model-failed': '模型调用失败',
                validated: '已完成字段校验',
                applied: '已应用',
              }[trace.status] ?? trace.status,
            )}
          </dd>
        </div>
        <div>
          <dt>{tr('返回原因')}</dt>
          <dd>
            {trace.finish_reason || tr('未记录')} ·{' '}
            {trace.prompt_tokens > 0 || trace.completion_tokens > 0
              ? `${trace.prompt_tokens} / ${trace.completion_tokens} tokens`
              : tr('用量未记录')}
          </dd>
        </div>
        <div>
          <dt>{tr('执行时间')}</dt>
          <dd>{new Date(trace.started_at).toLocaleString()}</dd>
        </div>
        <div>
          <dt>{tr('来源')}</dt>
          <dd>{tr(sourceNames[trace.source] ?? trace.source)}</dd>
        </div>
        <div>
          <dt>{tr('输出预算')}</dt>
          <dd>
            {trace.max_tokens} tokens · {tr('联网与思考输出关闭')}
          </dd>
        </div>
      </dl>
      {trace.requested_route_key && trace.requested_route_key !== trace.route_key && (
        <p>
          {tr('请求的模型')}：{trace.requested_route_key}；{tr('实际已回退')}
        </p>
      )}
      <Rules rules={trace.rules} pipeline={trace.pipeline} />
      {trace.inputs?.map((input, i) => (
        <p key={i}>
          {tr('输入裁剪')}：{input.original_runes} → {input.candidate_runes} → {input.prompt_runes}{' '}
          {tr('字（原文 → 候选 → 实际输入）')}
        </p>
      ))}
      {trace.prompt ? (
        <PromptText label={tr('实际发送给模型的完整内容')} value={trace.prompt} />
      ) : (
        <p>{tr('实际请求正文未记录或当前无权查看')}</p>
      )}
      {trace.raw_output && <PromptText label={tr('模型原始输出')} value={trace.raw_output} />}
      {trace.events?.map((event, index) => (
        <PromptText
          key={index}
          label={event.rule}
          value={tr('处理前') + '\n' + event.before + '\n\n' + tr('处理后') + '\n' + event.after}
        />
      ))}
      {trace.outcomes?.length ? (
        <PromptText
          label={tr('后端校验后的字段')}
          value={JSON.stringify(trace.outcomes, null, 2)}
        />
      ) : null}
      <p className="arkme-recognition-muted">
        {tr('展示实际执行的校验步骤及处理前后内容；缺失的历史步骤不推断补全。')}
      </p>
      <footer>
        {tr('规则版本')}：{trace.policy_version}
        <br />
        {tr('配置摘要')}：{trace.settings_revision}
        <br />
        {tr('实际请求 SHA-256')}：{trace.prompt_hash}
      </footer>
    </>
  )
}
