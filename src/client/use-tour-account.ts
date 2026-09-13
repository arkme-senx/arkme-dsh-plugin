import { homeTourDiagnostic } from './home-tour-diagnostics.js'
import { useEffect, useState } from 'react'
import type { ArkmeAuthSnapshot, ArkmeUserProfileSnapshot } from '../types.js'
import { callArkme } from './api.js'
import { homeTourAccountKey } from './home-tour-session.js'

// Inclusive cutoff: 2026-09-10 00:00 in China, independent of the device timezone.
export const TOUR_REGISTRATION_CUTOFF = Date.parse('2026-09-10T00:00:00+08:00')
export function isTourRegistrationEligible(createdAt: number | undefined): boolean {
 if (typeof createdAt !== 'number' || !Number.isSafeInteger(createdAt) || createdAt <= 0) return false
 // ProfileService preserves create_at from the account API, which uses microseconds.
 // Also accept millisecond timestamps from existing client snapshots.
 const createdAtMillis = createdAt >= 100_000_000_000_000 ? createdAt / 1000 : createdAt
 return createdAtMillis >= TOUR_REGISTRATION_CUTOFF
}

export function useTourAccount(auth: ArkmeAuthSnapshot | undefined): string | undefined {
 const account = homeTourAccountKey(auth)
 const userId = auth?.userId
 const [eligibleAccount, setEligibleAccount] = useState<string>()
 useEffect(() => {
  let cancelled = false
  setEligibleAccount(undefined)
  if (account === undefined) return
  homeTourDiagnostic('eligibility-query', { accountKey: account })
  void callArkme<ArkmeUserProfileSnapshot>('user.profile')
   .then(snapshot => {
    if (cancelled) return undefined
    return snapshot.profile === null ? callArkme<ArkmeUserProfileSnapshot>('user.profile.refresh') : snapshot
   })
   .then(snapshot => {
    const profile = snapshot?.profile
    homeTourDiagnostic('eligibility-result', { accountKey: account, cancelled, profilePresent: !!profile, accountMatches: profile?.userId === userId, eligible: isTourRegistrationEligible(profile?.createdAt) })
    if (!cancelled && profile && profile.userId === userId && isTourRegistrationEligible(profile.createdAt)) setEligibleAccount(account)
   })
   .catch(() => { homeTourDiagnostic('eligibility-query-failed', { accountKey: account, cancelled }) })
  return () => { cancelled = true }
 }, [account, userId])
 return account !== undefined && eligibleAccount === account ? account : undefined
}
