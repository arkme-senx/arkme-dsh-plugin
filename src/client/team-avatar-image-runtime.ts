import {BrowserAvatarPersistentCache} from './avatar-persistent-cache.js'
import { InMemoryArkmeAvatarImageStore } from './avatar-image-store.js'
import { callArkme } from './api.js'
import { ArkmeClientError } from '../sdk/index.js'
import { TEAM_AVATAR_CACHE_BATCH_SIZE, type TeamAvatarCacheHit } from '../team-app-contract.js'
import { arkmeAuthStore } from './auth-store.js'
import type { ArkmeAvatarImagePayload } from './avatar-image-store.js'

type PendingProbe = {
  ref: string
  key: string
  resolve(image: ArkmeAvatarImagePayload | undefined): void
}
const pendingProbes = new Map<string, PendingProbe[]>()

async function flushTeamAvatarProbes(scope: string, probes: PendingProbe[]): Promise<void> {
  pendingProbes.delete(scope)
  const hits = await callArkme<Array<TeamAvatarCacheHit | null>>('team.app.image-cache.batch', {
    imageRefs: probes.map(probe => probe.ref), expectedAccountKey: scope,
  }).catch(() => [])
  for (const [index, probe] of probes.entries()) {
    const hit = Array.isArray(hits) ? hits[index] : undefined
    probe.resolve(hit?.imageKey === probe.key ? { dataBase64: hit.base64, mediaType: hit.mimeType } : undefined)
  }
}

function readTeamAvatarFromDisk(ref: string, key: string): Promise<ArkmeAvatarImagePayload | undefined> {
  const auth = arkmeAuthStore.getSnapshot().auth
  if (auth?.status !== 'authenticated') return Promise.resolve(undefined)
  const scope = `${auth.environment}:${auth.userId}`
  return new Promise(resolve => {
    const queued = pendingProbes.get(scope)
    if (queued) queued.push({ ref, key, resolve })
    else {
      const probes = [{ ref, key, resolve }]
      pendingProbes.set(scope, probes)
      setTimeout(() => { void flushTeamAvatarProbes(scope, probes) }, 0)
    }
  })
}

/** Team authorization adapts to the existing account-scoped avatar cache. */
export const teamAvatarImages = new InMemoryArkmeAvatarImageStore({
  persistentCache:new BrowserAvatarPersistentCache(),
  cacheProbeConcurrency: TEAM_AVATAR_CACHE_BATCH_SIZE,
  canProbeCache: imageRef => imageRef.startsWith('team-app-image.'),
  cachedReader: readTeamAvatarFromDisk,
  warmReader: readTeamAvatarFromDisk,
  invalidateOnError: error => error instanceof ArkmeClientError && [
    'team-reference-invalid', 'team-not_accessible', 'team-account-changed',
  ].includes(error.body.code),
  reader: async imageRef => {
    const image = await callArkme<{base64: string; mimeType: string}>('team.app.image', {imageRef}, undefined, { priority: 'background' })
    return {dataBase64: image.base64, mediaType: image.mimeType}
  },
})

/** The live directory still owns which avatars may render. */
export async function warmTeamDirectoryAvatars(scope: string, signal: AbortSignal): Promise<void> {
  const images = await callArkme<readonly { ref: string; key: string }[]>('team.app.image-manifest', { expectedAccountKey: scope }, signal)
  if (signal.aborted) return
  for (const {ref, key} of images) void teamAvatarImages.warmFromDisk(scope, ref, key)
}
