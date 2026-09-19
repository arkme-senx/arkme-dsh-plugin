import { useCallback, useEffect, useState } from 'react'
import type { ArkmeMembership } from '../types.js'
import { callArkme } from './api.js'

export type MembershipState = { status: 'loading' | 'error' } | { status: 'ready'; value: ArkmeMembership }
export function membershipLabel(state: MembershipState): string {
  if (state.status !== 'ready') return state.status === 'loading' ? '读取中' : '待确认'
  return ['免费版', 'VIP', 'SVIP'][state.value.memberType] ?? '待确认'
}
export function membershipDescription(state: MembershipState): string {
  if (state.status !== 'ready') return state.status === 'loading' ? '正在读取会员状态' : '会员状态暂时无法确认，点击重试'
  const member = state.value
  if (member.memberType === 0) return '查看更多存储、转写与协作权益'
  if (member.lifetime) return '永久会员'
  const date = member.expireAtMillis === null ? '有效期以手机端为准' : `${new Date(member.expireAtMillis).toLocaleDateString('zh-CN')} 到期`
  return member.gifted ? `赠送会员 · ${date}` : date
}

/** Never retain one account's membership under another account, even for one render. */
export function useMembership(accountScope: string | undefined, userId: number | undefined, profileOpen: boolean) {
  const [revision, setRevision] = useState(0)
  const [result, setResult] = useState<{ scope: string; state: MembershipState }>()
  const refresh = useCallback(() => setRevision(value => value + 1), [])
  useEffect(() => { if (profileOpen) refresh() }, [profileOpen, refresh])
  useEffect(() => {
    if (!accountScope || userId === undefined) return
    let active = true
    const controller = new AbortController()
    setResult(previous => previous?.scope === accountScope && previous.state.status === 'ready'
      ? previous : { scope: accountScope, state: { status: 'loading' } })
    void callArkme<ArkmeMembership>('membership.current', { expectedUserId: userId }, controller.signal)
      .then(value => {
        if (active && value.userId === userId) setResult({ scope: accountScope, state: { status: 'ready', value } })
        else if (active) setResult({ scope: accountScope, state: { status: 'error' } })
      })
      .catch(() => { if (active) setResult({ scope: accountScope, state: { status: 'error' } }) })
    return () => { active = false; controller.abort() }
  }, [accountScope, userId, revision])
  return { state: result && result.scope === accountScope ? result.state : { status: 'loading' } as MembershipState, refresh }
}
