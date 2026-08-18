import type { ArkmeToolProfile } from '../contract/module.js'
import { ARKME_BUSINESS_TOOL_PROMPT, businessToolPrompt } from './business.js'

export const ARKME_TOOL_PROMPT = ARKME_BUSINESS_TOOL_PROMPT

export function promptForArkmeToolProfile(
  profile: ArkmeToolProfile,
  availability: { attachments: boolean } = { attachments: true },
): string {
  return profile === 'business' || profile === 'hybrid'
    ? businessToolPrompt(availability.attachments)
    : ''
}
