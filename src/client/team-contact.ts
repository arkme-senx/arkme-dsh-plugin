import type { ArkmeTeam } from '../types.js'
import type { TeamOutboundOpenResult } from '../team-outbound-contract.js'
import type { TeamOutboundPerson } from './team-outbound.js'
import { callArkme } from './api.js'
import { ResourceStore } from './resource-store.js'
import { tr } from './locale.js'
import { arkmeAuthStore } from './auth-store.js'

export interface TeamContactContext { accountKey: string; person: TeamOutboundPerson }

export const teamContactTeams = new ResourceStore<ArkmeTeam[], string>({
  freshForMs: 30_000,
  async load(accountKey, signal) {
    const values = await callArkme<ArkmeTeam[]>('team.app.teams', { expectedAccountKey: accountKey }, signal)
    if (!Array.isArray(values) || values.some(team => !team.teamRef || !team.jotmoId || !team.name)) throw new Error(tr('团队列表返回异常，请重试'))
    return values
  },
}, Date.now, 8)

const preferenceKey = (accountKey: string) => `arkme.team-contact.preferred.v1:${accountKey}`
export function preferredContactTeam(accountKey: string): string {
  try { return typeof window === 'undefined' ? '' : window.localStorage.getItem(preferenceKey(accountKey)) ?? '' } catch { return '' }
}
export function rememberContactTeam(accountKey: string, team: ArkmeTeam): void {
  try { if (typeof window !== 'undefined') window.localStorage.setItem(preferenceKey(accountKey), team.jotmoId) } catch { /* Preference storage never blocks contact. */ }
}
export function chooseContactTeam(teams: readonly ArkmeTeam[], accountKey: string, chosen = '', fixed?: string): ArkmeTeam | undefined {
  if (fixed) return teams.find(team => team.jotmoId === fixed)
  return teams.find(team => team.jotmoId === chosen) ?? teams.find(team => team.jotmoId === preferredContactTeam(accountKey)) ?? teams[0]
}
export function contactTeamError(error: unknown, team: ArkmeTeam): string {
  return (error as { body?: { code?: string } })?.body?.code === 'team-channel_paused'
    ? tr(team.currentUserRole === 'owner' ? '开启路径：联系人 → 团队 → {team} → 团队消息通道 → 接收外部消息'
      : '请团队所有者开启：联系人 → 团队 → {team} → 团队消息通道 → 接收外部消息', { team: team.name })
    : error instanceof Error ? error.message : tr('打开会话失败，请重试')
}
export async function openTeamContact(context: TeamContactContext, team: ArkmeTeam, requestUid: string, signal: AbortSignal) {
  signal.throwIfAborted()
  const controller = new AbortController()
  let accountChanged = false
  const checkAccount = () => {
    const auth = arkmeAuthStore.getSnapshot().auth
    if (auth?.status !== 'authenticated' || `${auth.environment}:${auth.userId}` !== context.accountKey) {
      accountChanged = true; controller.abort()
    }
  }
  const abort = () => controller.abort()
  signal.addEventListener('abort', abort, { once: true })
  const stop = arkmeAuthStore.subscribe(checkAccount)
  checkAccount()
  try {
    controller.signal.throwIfAborted()
    const result = await callArkme<TeamOutboundOpenResult>('team.app.outbound.open', {
      expectedAccountKey: context.accountKey, teamRef: team.teamRef, recipient: context.person.recipient, requestUid,
    }, controller.signal)
    controller.signal.throwIfAborted()
    if (result.state !== 'ready' || !result.conversation?.ref || !result.conversation.key || result.conversation.side !== 'team'
      || result.conversation.channel?.jotmoId !== team.jotmoId) throw new Error(tr('团队会话返回异常，请重试'))
    return result.conversation
  } catch (error) {
    if (accountChanged) throw new Error(tr('登录账号已变化，请重新打开此窗口'))
    throw error
  } finally { stop(); signal.removeEventListener('abort', abort) }
}
