import type { ComponentProps, RefObject } from 'react'
import { ArkmeRecordingTimeline } from './ArkmeRecordingTimeline.js'
import type { ArkmeRecordingWorkbenchItem } from '../../types.js'
import { useRecordingReadingPosition } from './useRecordingReadingPosition.js'

/** Keep scroll-driven updates inside the header, away from the all-day transcript list. */
export function RecordingTranscriptTimeline({ transcriptRoot, followTranscript, readingItems, ...props }: ComponentProps<typeof ArkmeRecordingTimeline> & {
  transcriptRoot: RefObject<HTMLDivElement>
  followTranscript: boolean
  readingItems?: readonly Pick<ArkmeRecordingWorkbenchItem, 'itemId' | 'startAtMillis' | 'endAtMillis'>[]
}) {
  const readingRange = useRecordingReadingPosition(transcriptRoot, readingItems ?? props.items, followTranscript, props.dayStartMillis ?? 0)
  return <ArkmeRecordingTimeline {...props} readingRange={readingRange} />
}
