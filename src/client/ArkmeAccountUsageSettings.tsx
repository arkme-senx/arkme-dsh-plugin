import { tr, useArkmeLocale } from './locale.js'
import { useRef, useState, useSyncExternalStore } from 'react'
import { arkmeAuthStore } from './auth-store.js'
import { ArkmeAccountUsageDetails } from './ArkmeAccountUsage.js'
import { ArkmeMembershipDialog } from './ArkmeMembershipDialog.js'
import { useMembership } from './arkme-membership.js'

export function ArkmeAccountUsageSettings() {
  useArkmeLocale()
  const { auth } = useSyncExternalStore(arkmeAuthStore.subscribe, arkmeAuthStore.getSnapshot, arkmeAuthStore.getSnapshot)
  if (auth?.status !== 'authenticated' || auth.userId === undefined) return <p>{tr("登录后查看用量与额度")}</p>
  const scope = `${auth.environment}:${auth.userId}`
  return <UsageSettings key={scope} scope={scope} userId={auth.userId} />
}

function UsageSettings({ scope, userId }: { scope: string; userId: number }) {
  useArkmeLocale()
  const [memberOpen, setMemberOpen] = useState(false)
  const membership = useMembership(scope, userId, memberOpen)
  const membershipTrigger = useRef<HTMLButtonElement>(null)
  return <div className="arkme-usage-settings" data-arkme-settings-page="usage">
    <ArkmeAccountUsageDetails accountScope={scope} onViewMembership={() => setMemberOpen(true)} onRefreshMembership={membership.refresh} />
    <button ref={membershipTrigger} type="button" className="arkme-settings-link" onClick={() => setMemberOpen(true)}>{tr("查看会员权益 ›")}</button>
    {memberOpen && <ArkmeMembershipDialog userId={userId} state={membership.state} onRefresh={membership.refresh} onClose={() => setMemberOpen(false)} returnFocusRef={membershipTrigger} />}
  </div>
}
