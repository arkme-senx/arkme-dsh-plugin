import { tr } from '../../locale.js'
import { useCodexActivity } from './use-codex-activity.js'
import { codexActivityPresentation, type CodexActivitySnapshot } from './codex-activity.js'
import { CodexTaskStateDot, codexTaskStatusLabel } from './CodexTaskStateDot.js'

export function CodexActivityLabel({ snapshot }: { snapshot?: CodexActivitySnapshot }) {
  const view = codexActivityPresentation(snapshot)
  const label = view.kind === 'updating' ? tr('状态更新中…')
    : view.kind === 'unknown' ? tr('任务状态待核实')
    : view.task?.title ?? (view.kind === 'running' ? tr('{count} 个任务进行中',{count:view.count!}) : tr('我的任务与对话'))
  const title = view.status ? `${codexTaskStatusLabel(view.status)} · ${label}` : label
  return <span className="arkme-codex-activity-preview" title={title} aria-label={title} data-codex-activity={view.kind}>
    {view.status && <CodexTaskStateDot status={view.status}/>}
    <span>{label}</span>
  </span>
}

export function CodexActivityPreview({ accountKey,userId,active }: { accountKey?:string|undefined;userId?:number|undefined;active:boolean }) {
  const snapshot = useCodexActivity(accountKey,userId,active)
  return <CodexActivityLabel {...(snapshot ? {snapshot} : {})}/>
}
