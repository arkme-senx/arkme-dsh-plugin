import { createArkmeSdk, type ArkmeSdkOptions, type SpeechCapabilities, type SpeechQuery, type SpeechState, type SpeechOccurrences, type SpeechSource } from '@senguoyun/dsh-arkme/sdk'
// This compiles using only the packed public SDK. Runtime acceptance additionally
// runs this consumer against an unmodified isolated DSH Host.
export async function readSelfSpeech(options: ArkmeSdkOptions, signal: AbortSignal, date: string, timezone: string): Promise<SpeechState> {
 const sdk = createArkmeSdk(options)
 try {
  const capability: SpeechCapabilities = await sdk.speechStatisticsCapabilities(signal)
  if (!capability.supported || capability.version !== 2) throw new Error('unsupported original-audio capability')
  const query: SpeechQuery = { accountScope: capability.accountScope, date, timezone }
  const state: SpeechState = await sdk.speechStatisticsState(query, signal)
  if (state.result && !state.stale && state.result.terms.length) {
   const page: SpeechOccurrences = await sdk.speechStatisticsOccurrences({ ...query, resultId: state.result.id, termKey: state.result.terms[0].key, mode: 'all' }, signal)
   const occurrence = page.items.find(item => item.sourceRef)
   if (occurrence?.sourceRef) {
    const source: SpeechSource = await sdk.speechStatisticsSource({ ...query, resultId: state.result.id, sourceRef: occurrence.sourceRef, action: 'play' }, signal)
    if (!sdk.mediaUrl(source.playback.playbackRef)) throw new Error('missing opaque playback reference')
   }
  }
  return state
 } finally { sdk.dispose() }
}
