import type { DshAccountSession } from '../dsh-remote/account-session-types.js'

export const HARNESS_NATIVE_OPEN = 'arkme:native-session-open'
export type NativeSessionRequest = { runtimeRef: string; sessionRef: string; revision?: number; accountId?: string; accountScope?: string }

/** The parent retains native documents; a selection never navigates or reloads them. */
export async function openNativeAccountSession(session: Pick<DshAccountSession, 'runtimeRef' | 'sessionRef'>, localRuntimeRef?: string): Promise<void> {
  const surface = window.frameElement?.parentElement
  if (!surface) throw new Error('DSH 对话容器尚未就绪')
  const doc = surface.ownerDocument
  const runtimeRef = session.runtimeRef === localRuntimeRef ? '' : session.runtimeRef
  doc.dispatchEvent(new doc.defaultView!.CustomEvent(HARNESS_NATIVE_OPEN, { detail: {
    runtimeRef,
    sessionRef: session.sessionRef,
    accountId: surface.getAttribute('data-arkme-account-id') ?? '',
    accountScope: surface.getAttribute('data-arkme-account-scope') ?? '',
  } satisfies NativeSessionRequest }))
}
