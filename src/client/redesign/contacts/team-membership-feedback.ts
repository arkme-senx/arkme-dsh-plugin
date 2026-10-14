import { ArkmeClientError } from '../../../sdk/index.js'
const statusFailureText = '暂时无法更新加入状态，恢复连接后会自动更新'

const joinLabels = {
  joined: '已加入团队',
  pending: '申请已提交，等待团队所有者审批',
  rejected: '加入申请未通过，可重新申请',
  not_member: '当前已不是团队成员，可重新申请',
  none: '尚未申请加入此团队',
} as const
export type TeamJoinState = keyof typeof joinLabels
export function teamJoinState(value: unknown): TeamJoinState | undefined {
  return typeof value === 'string' && Object.hasOwn(joinLabels, value) ? value as TeamJoinState : undefined
}
export function teamJoinLabel(state: TeamJoinState): string { return joinLabels[state] }

/** Parsing failures and invalid link shapes have the same user-facing recovery. */
export function teamMessageLinkRef(input: string): string | undefined {
  try {
    const url = new URL(input.trim())
    const ref = url.searchParams.get('channel') ?? ''
    if (url.protocol === 'https:' && url.pathname === '/team-message' && !url.username && !url.password
      && !url.hash && url.searchParams.getAll('channel').length === 1 && /^[a-f0-9]{32}$/.test(ref)) return ref
  } catch { /* The native URL diagnostic is not product copy. */ }
  return undefined
}

/** Only stable codes and explicitly bounded business copy may reach the form. */
export function teamMembershipErrorText(error: unknown, action: 'create' | 'join' | 'status'): string {
  if (error instanceof ArkmeClientError) {
    const { code, message } = error.body
    if (code === 'social-phone-binding-required') return '绑定手机号后继续'
    if (action === 'create' && code === 'team-create-rejected') {
      if (['该即我号已被占用', '即我号格式不正确', '创建未完成，请检查团队名称和即我号后重试'].includes(message)) return message
    }
    if (code === 'login-required' || code === 'login-expired') return '登录已失效，请重新登录后再试'
    if (['team-account-changed', 'social-account-changed', 'login-context-changed', 'read-account-changed'].includes(code)) return '登录账号已变化，请重新打开此窗口'
    if (action === 'status') return statusFailureText
    if (code === 'local-network-unavailable') return '暂时无法连接，请检查网络后重试'
    if (code === 'team-rate_limited') return '操作过于频繁，请稍后重试'
    if (code === 'arkme-timeout') return '操作超时，请稍后重试'
    if (action === 'join' && ['team-invalid_request', 'arkme-code-1001'].includes(code)) return '请检查团队即我号是否正确，再试一次'
  }
  return action === 'create' ? '暂时无法创建团队，请稍后重试'
    : action === 'join' ? '暂时无法加入团队，请稍后重试' : statusFailureText
}
