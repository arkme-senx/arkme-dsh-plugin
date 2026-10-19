import { useState } from 'react'
import type { TeamCodexTask } from '../../../team-codex-contract.js'
import { arkmeIntlLocale, tr } from '../../locale.js'

export function codexCollectorUnavailable(task: TeamCodexTask): boolean {
  return task.captureHealth ? task.captureHealth.status !== 'online' : task.cloud?.remote === true
}

export function codexSyncLabel(task: TeamCodexTask): string {
  const status = task.captureHealth?.status
  return tr(status === 'offline' ? '同步已中断' : status === 'buffering' ? '本地暂存中'
    : status === 'paused' ? '采集已暂停' : status === 'online' ? '采集端在线' : '同步状态待核实')
}

export function CodexSyncStatus({ task }: { task: TeamCodexTask }) {
  const [details, setDetails] = useState(false)
  if (!task.captureHealth && !task.cloud?.remote) return null
  const at = task.captureHealth?.lastReceivedAt ?? task.updatedAt
  const stamp = new Date(at).toLocaleString(arkmeIntlLocale(), { year: 'numeric', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
  const explanation = task.captureHealth?.status === 'offline'
    ? '已找到本机配置的采集来源，但采集服务未运行或已切换账号。请在绑定账号的正式客户端恢复接入；刷新对话不会补回未采集的内容。'
    : task.captureHealth?.status === 'buffering'
      ? '采集服务暂时离线，仍在有效授权期内。新事件先保存在本地，服务恢复后上传；退出账号或撤销授权会停止采集。'
      : task.captureHealth?.status === 'online'
        ? '采集服务正在运行。仍需在 Codex 中信任采集 Hooks，新输入和最终回答才会继续同步；服务在线不代表新事件已经上传，长时间没有新消息也不代表断线。'
        : task.captureHealth?.status === 'paused'
          ? '此来源已暂停或断开采集。历史内容保留；恢复后才继续采集新内容。'
          : '这里只读取云端副本，尚无法核实来源采集端的运行状态。最后收到的时间不代表任务仍在执行，也不能据此判断来自另一台电脑。'
  return <div className="arkme-codex-sync-status">
    <small role="status">{codexSyncLabel(task)} · {tr('最后收到')} <time dateTime={new Date(at).toISOString()}>{stamp}</time></small>
    {' '}<button type="button" aria-expanded={details} onClick={() => setDetails(!details)}>{tr(details ? '收起' : '查看原因')}</button>
    {details && <p>{tr(explanation)}</p>}
  </div>
}
