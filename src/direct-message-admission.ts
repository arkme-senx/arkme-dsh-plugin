/** Public business projection; no Chat internal IDs or user IDs cross the Host boundary. */
export interface ArkmeDirectMessageAdmission {
  state: 'allowed' | 'refused_by_self' | 'refused_by_counterpart' | 'mutually_refused'
  canSend: boolean
  /** Rollout permission only; disabling creation never revokes existing refusal. */
  refusalCreationEnabled: boolean
  ownRefused: boolean
  counterpartRefused: boolean
  ownRevision: number
  counterpartRevision: number
}

export interface ArkmeDirectMessageAdmissionPort {
  directMessageAdmission(sourceRef: string, signal?: AbortSignal): Promise<ArkmeDirectMessageAdmission>
  setDirectMessageRefusal(sourceRef: string, refused: boolean, expectedRevision: number, signal?: AbortSignal): Promise<ArkmeDirectMessageAdmission>
}

export function directMessageAdmissionMessage(admission: ArkmeDirectMessageAdmission): string {
  switch (admission.state) {
    case 'allowed': return ''
    case 'refused_by_self': return '你已拒收对方的消息'
    case 'refused_by_counterpart': return '对方已拒收你的消息'
    case 'mutually_refused': return '你们已互相拒收消息'
  }
}
