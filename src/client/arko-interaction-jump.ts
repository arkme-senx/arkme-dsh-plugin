import type { ArkmeRecordThought } from "../record-thought-contract.js"
import type { RecordOwnerId } from '../record-owner-id.js'
/** One explicit navigation request, scoped to the authenticated account and root. */
interface ArkoInteractionJump { scope: string; sourceKey: string; rootUid: string; recordOwnerUserId: RecordOwnerId; replyId?: string; thought?: ArkmeRecordThought; revision: number; expiresAt: number }
let value: ArkoInteractionJump | undefined, revision = 0
const listeners = new Set<() => void>()
export const arkoInteractionJump = {
  subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener) } },
  snapshot() { return value },
  request(next: Omit<ArkoInteractionJump,'revision'|'expiresAt'>) { value = { ...next, revision: ++revision, expiresAt: Date.now()+30000 }; for(const listener of listeners) listener() },
  consume(expected: number) { if(value?.revision===expected) { value=undefined; for(const listener of listeners) listener() } },
}
