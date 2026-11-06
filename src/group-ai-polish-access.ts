/** AI configuration uses the viewer's human group membership, not team representation. */
export const GROUP_AI_POLISH_MEMBERSHIP_REQUIRED = 'group-ai-polish-membership-required'

export function isGroupAiPolishMembershipRequired(error: unknown): boolean {
  const failure = error as { code?: unknown; body?: { code?: unknown } } | undefined | null
  return (failure?.body?.code ?? failure?.code) === GROUP_AI_POLISH_MEMBERSHIP_REQUIRED
}
