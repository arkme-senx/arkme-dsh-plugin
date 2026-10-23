import type { TeamCodexEvent } from './team-codex-contract.js'

/** Exact, app-generated request envelopes, not keyword or title matching.
 * A verified persistent user thread always takes precedence over these signatures.
 */
export function codexInternalRequest(text: string): boolean {
  return text.startsWith('This is an app-generated request for a suggested next user message. The user did not write this message.\n\n')
    && text.includes('"suggestion"')
    || /^# Overview\r?\n\r?\nGenerate 0 to 3 hyperpersonalized suggestions for what this user can do with Codex in this (?:local project:|Projectless task)/.test(text)
    || text.startsWith('## Memory Writing Agent: Phase 2 (Consolidation)\n\nYou are a Memory Writing Agent.\n')
    || text.startsWith('Consolidate the supplied rollout summaries into `memory_summary.md` so another\nagent understands the user, finds relevant prior work, and continues correctly.\n')
    || text.startsWith('You are an expert at upholding safety and compliance standards for Codex ambient suggestions.\n\nI will present you with two categories of content:')
}

/** Only a complete small history can classify old cloud rows without native session IDs. */
export function codexInternalHistory(events: readonly Pick<TeamCodexEvent, 'kind' | 'text' | 'truncated'>[]): boolean {
  const prompts = events.filter(event => event.kind === 'UserPromptSubmit')
  return prompts.length > 0 && prompts.every(event => !event.truncated && codexInternalRequest(event.text))
}
