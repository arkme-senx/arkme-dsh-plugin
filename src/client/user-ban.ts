export function shouldShowUserBanAction(input: {
  authenticated: boolean
  sourceKind: string | undefined
  accountType: number | undefined
  peerUserId: number | undefined
  currentUserId: number | undefined
}): boolean {
  return input.authenticated
    && input.sourceKind === 'private_chat'
    && input.accountType === 2
    && input.peerUserId !== undefined
    && Number.isSafeInteger(input.peerUserId)
    && input.peerUserId > 0
    && input.peerUserId !== input.currentUserId
}
