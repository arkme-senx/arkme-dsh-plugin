import { useEffect, useId, useState } from 'react'
import { IconChevronDownOutline14, IconChevronUpOutline14, IconQueueOutline14 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { TeamCodexQueuedRequest, TeamCodexTask } from '../../../team-codex-contract.js'
import { tr, useArkmeLocale } from '../../locale.js'

export const isCodexTaskLive = (task: TeamCodexTask): boolean => task.status === 'active' && !task.excluded && !task.projectExcluded
const waiting = (item: TeamCodexQueuedRequest): boolean => item.delivery === 'queue' && ['queued', 'pending'].includes(item.state)

export function codexQueueAvailability(task: TeamCodexTask) {
  if (!isCodexTaskLive(task)) return 'paused'
  if (!task.queue) return 'unavailable'
  return task.queue.availability === 'ready' && Date.now() - task.queue.checkedAt > 15_000 ? 'stale' : task.queue.availability
}

function queueWarning(task: TeamCodexTask): string {
  if (task.cloud?.remote) return tr('排队请求暂仅在来源电脑可见')
  switch (codexQueueAvailability(task)) {
    case 'paused': return tr('队列同步已暂停')
    case 'unavailable': return tr('队列暂不可读')
    case 'partial': return tr('队列不完整')
    case 'stale': return tr('队列状态待更新')
    default: return ''
  }
}

export function codexQueueLabel(task: TeamCodexTask): string {
  const warning = queueWarning(task)
  if (warning) return warning
  const items = task.queue?.items ?? []
  if (items.some(item => !waiting(item))) return tr('待处理 {count} 条', { count: items.length })
  return items.length ? tr('排队 {count} 条', { count: items.length }) : tr('暂无排队请求')
}

function itemStatus(item: TeamCodexQueuedRequest): string {
  if (item.state === 'unknown') return tr('发送结果待确认')
  if (item.state === 'sending') return tr('正在发送')
  if (item.paused) return tr('等待继续')
  return item.delivery === 'send-now' ? tr('待发送') : ''
}

// Presentation adapted from DSH QueueDock 0.1.5-rc.2 (MIT, DeepSeek).
// Keep its single-row / collapsed multi-row behavior, but not its DSH session
// mutations: this is a read-only Codex snapshot, not the Harness scheduler.
// License: assets/licenses/DSH_QueueDock_LICENSE.txt (distributed with the package).
export function CodexQueueDock({ task }: { task: TeamCodexTask }) {
  useArkmeLocale()
  const [collapsed, setCollapsed] = useState(true)
  const listId = useId()
  const items = isCodexTaskLive(task) && !task.cloud?.remote ? task.queue?.items ?? [] : []
  const count = items.length
  const warning = queueWarning(task)
  useEffect(() => { if (count === 0) setCollapsed(true) }, [count])
  if (!count && !warning) return null

  const listVisible = count === 1 || !collapsed
  // A folded dock must not conceal an uncertain send outcome or a paused row.
  const pendingStatus = ['unknown', 'sending'].map(state => items.find(item => item.state === state)).find(Boolean)
    ?? items.find(item => item.paused || item.delivery === 'send-now')
  const status = pendingStatus ? itemStatus(pendingStatus) : ''
  const warningTitle = warning && count ? `${warning} · ${tr('以下保留上次可读取的内容，数量和顺序可能不完整。')}` : warning
  const label = warning ? tr('上次队列 {count} 条', { count })
    : items.some(item => !waiting(item)) ? tr('待处理 {count} 条', { count })
    : tr('{count} 条排队消息', { count })
  const lead = <span className="arkme-codex-queue-lead" aria-hidden="true"><IconQueueOutline14/></span>
  return <div className="arkme-codex-queue-dock" data-codex-queue-dock="">
    <div className="arkme-codex-queue-panel">
      {count > 1 && <button type="button" className="arkme-codex-queue-header" aria-expanded={!collapsed} aria-controls={listId} onClick={() => setCollapsed(value => !value)}>
        {lead}<span className="arkme-codex-queue-count">{label}</span>
        {!listVisible && status && <span className="arkme-codex-queue-status" role="status">{status}</span>}
        <span className="arkme-codex-queue-chevron" aria-hidden="true">{collapsed ? <IconChevronUpOutline14/> : <IconChevronDownOutline14/>}</span>
      </button>}
      {warning && <div className="arkme-codex-queue-notice" role="status" title={warningTitle}>{!count && lead}<span>{warning}</span></div>}
      {!!count && <ul id={listId} className="arkme-codex-queue-list" aria-label={tr('排队请求')} hidden={!listVisible}>
        {listVisible && items.map(item => {
          const content = item.text || tr('无文本输入')
          const state = itemStatus(item)
          return <li className="arkme-codex-queue-row" key={item.id}>
            {count === 1 && lead}
            <span className="arkme-codex-queue-preview" title={item.truncated ? `${content} · ${tr('正文已截断')}` : content}>{content}</span>
            {item.attachmentCount > 0 && <span className="arkme-codex-queue-status">{tr('{count} 个附件', { count: item.attachmentCount })}</span>}
            {state && <span className="arkme-codex-queue-status" role="status">{state}</span>}
          </li>
        })}
      </ul>}
    </div>
  </div>
}
