import type { ArkmeRecordingSearchIdentity, ArkmeRecordingWorkbenchItem } from '../../types.js'
/** Hash the complete selector without adding raw Audio owner ids to the day document. */
export async function resolveRecordingSearchTarget(items: readonly ArkmeRecordingWorkbenchItem[], target: ArkmeRecordingSearchIdentity): Promise<ArkmeRecordingWorkbenchItem | undefined> {
  const bytes = new TextEncoder().encode(JSON.stringify([target.sessionId,target.transcriptSource,target.childId,target.itemIndex]))
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes)
  const identityHash = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2,'0')).join('')
  return items.find(item => item.searchIdentityHash === identityHash && item.searchVersion === target.transcriptVersion && item.transcriptSource === target.transcriptSource)
}
