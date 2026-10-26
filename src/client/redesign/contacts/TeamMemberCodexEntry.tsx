import { useEffect, useState } from 'react'
import type { TeamMemberCodexSync } from '../../../team-member-codex-sync.js'
import { teamText as tr } from '../../team-messaging-i18n.js'

export function TeamMemberCodexEntry({ sync, name, identityAvailable, busy, onOpen, onRetry }: {
  sync: TeamMemberCodexSync | undefined
  name: string
  identityAvailable: boolean
  busy: boolean
  onOpen(): void
  onRetry(): Promise<void>
}) {
  const [retry, setRetry] = useState<'checking' | 'failed'>()
  useEffect(() => { setRetry(undefined) }, [sync])
  const state: TeamMemberCodexSync = sync ?? { state: 'unavailable', reason: 'unsupported' }
  let label = ''
  if (retry === 'checking') label = '正在获取同步状态…'
  else if (retry === 'failed') label = '状态获取失败'
  else if (state.state === 'unavailable') label = state.reason === 'unsupported' ? '同步状态暂不可用' : '状态获取失败'
  else if (state.state === 'not_connected') label = '未开通同步'
  else if (state.state === 'paused') label = '已暂停同步'
  else if (state.state === 'disabled') label = '已关闭同步'
  else if (!state.hasConversations) label = '已开通·暂无对话'
  const canOpen = !retry && state.state !== 'unavailable' && state.canViewConversations
  if (!identityAvailable && canOpen) label = '身份信息暂不可用'
  else if (!label && !canOpen) label = '暂无对话查看权限'
  return <span className="arkme-team-member-sync" data-codex-sync={retry ?? state.state}>
    {label && <span className="arkme-team-member-sync-status" role="status"
      title={state.state === 'unavailable' && state.reason === 'unsupported'
        ? tr('成员同步状态接口开发中，暂时无法确认是否开通。') : undefined}>{tr(label)}</span>}
    {canOpen && identityAvailable && <button type="button" className="arkme-team-member-conversations"
      aria-label={tr('查看 {name} 的 Codex 对话', { name })} disabled={busy} onClick={onOpen}>
      {tr('查看对话')} <span aria-hidden>›</span>
    </button>}
    {(retry === 'failed' || !retry && state.state === 'unavailable' && state.reason !== 'unsupported') &&
      <button type="button" className="arkme-team-member-conversations" aria-label={tr('重试获取 {name} 的同步状态', { name })}
        onClick={() => { setRetry('checking'); void onRetry().then(() => setRetry(undefined), () => setRetry('failed')) }}>{tr('重试')}</button>}
  </span>
}
