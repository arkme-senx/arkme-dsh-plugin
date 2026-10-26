import { useCallback, useEffect, useState } from 'react'
import type { ReactionActor } from '../reaction-contract.js'
import type { TeamIdentity } from '../team-app-contract.js'
import type { ArkmeUserProfile, ArkmeUserProfileSnapshot } from '../types.js'
import { callArkme } from './api.js'
import { useProfileRevision } from './profile-change-store.js'

/** Optional identity presentation uses the same profile and Team remark projections. */
export function useTeamReactionActors(accountKey: string, people: readonly TeamIdentity[], fallbackSelf?: TeamIdentity) {
  const revision = useProfileRevision()
  const [loaded, setLoaded] = useState<{ accountKey: string; profile: ArkmeUserProfile }>()
  const userId = Number(accountKey.split(':').at(-1))
  useEffect(() => {
    const abort = new AbortController()
    void callArkme<ArkmeUserProfileSnapshot>('user.profile', undefined, abort.signal)
      .then(async snapshot => snapshot.profile === null
        ? await callArkme<ArkmeUserProfileSnapshot>('user.profile.refresh', undefined, abort.signal) : snapshot)
      .then(snapshot => {
        if (!abort.signal.aborted && snapshot.profile?.userId === userId) setLoaded({ accountKey, profile: snapshot.profile })
      }).catch(() => { /* Keep known names; presentation cannot block reactions. */ })
    return () => abort.abort()
  }, [accountKey, userId, revision])
  const self = loaded?.accountKey === accountKey ? loaded.profile : undefined
  const selfName = self?.displayName.trim() || self?.nickname.trim() || fallbackSelf?.nickname || '我'
  const peopleByKey = new Map(people.filter(person => person.personKey).map(person => [person.personKey!, person]))
  const resolveActor = useCallback((actor: ReactionActor): ReactionActor | undefined => {
    if (actor.userId === userId && selfName !== '我') return { ...actor, displayName: selfName,
      ...(self?.avatarRef ? { avatarRef: self.avatarRef } : {}), presentationPending: false }
    const person = actor.teamPersonKey ? peopleByKey.get(actor.teamPersonKey) : undefined
    return person?.nickname.trim() ? { ...actor, displayName: person.nickname, presentationPending: false } : undefined
  }, [userId, selfName, self?.avatarRef, peopleByKey])
  return { selfName, selfAvatarRef: self?.avatarRef, resolveActor }
}
