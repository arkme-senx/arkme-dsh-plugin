import { textLinkRuns } from './text-link-parser.js'

/** Extract before the search excerpt is clipped, using the same safe URLs as chat rendering. */
export function arkmeSearchRecordLinks(text: string): string[] {
  return [...new Set(textLinkRuns(text).flatMap(run => run.kind === 'link' ? [run.href] : []))]
}
