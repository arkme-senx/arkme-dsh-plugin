import type { ArkmeSdk, WorldSuggestionsState, WorldSuggestionPrepared } from '@senguoyun/dsh-arkme/sdk'
export async function suggestionsConsumer(sdk: ArkmeSdk, accountKey: string, signal: AbortSignal) {
  const state: WorldSuggestionsState = await sdk.worldSuggestions({ action: 'state', accountKey, includeItems: true }, signal)
  if (!state.items[0]) return state
  const original: WorldSuggestionPrepared = await sdk.worldSuggestions({ action: 'prepare', accountKey, ref: state.items[0].ref }, signal)
  return { state, original }
}
